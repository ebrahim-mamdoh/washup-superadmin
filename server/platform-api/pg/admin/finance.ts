import "server-only";

import type {
  CommissionSettings,
  DiscrepancyDetails,
  FinanceOverview,
  FinancePeriod,
  Payout,
  PayoutListItem,
  Transaction,
  TransactionListItem,
  TransactionStatus,
} from "@/types/finance";

import { daysAgo, now, round2 } from "../../db";
import { payoutIncrement, settlementPeriod } from "../../finance-rules";
import { ORDER_CURRENCY, ORDER_MONEY_JOIN, reportCurrency, reportZone, zoneDayRanges } from "./report-days";
import { MockApiError, ok, requireText } from "../../http";
import { PAYOUT_COLS, TRANSACTION_COLS, auditWhere, businessesWhere, payoutsWhere, transactionsWhere } from "../entities";
import { countsOf, orderBy, paged, searchPattern } from "../list";
import { actorNames } from "../lookups";
import { defaultCommissionPct, logAudit, pushVendorNotification, setCommissionRate } from "../platform";
import { route } from "../router";
import { type Q, db, tx } from "../sql";

const TXN_STATUSES: TransactionStatus[] = ["pending", "paid", "refunded", "settled"];
const PERIOD_DAYS: Record<FinancePeriod, number> = { today: 1, "7d": 7, "30d": 30 };

/**
 * Transaction list item columns (alias t + bz, o, p): business name, order
 * number, payment method and the first collected payment, like the mock `toTxnItem`.
 */
const TXN_ITEM = (q: Q) => q`
  select ${q.unsafe(TRANSACTION_COLS)}, coalesce(bz.name, '{"ar":"—","en":"—"}'::jsonb) as "businessName",
         coalesce(o.number, '—') as "orderNumber", o.payment_method as "paymentMethod", p.amount as "collectedAmount",
         coalesce(cx.symbol, c.currency_symbol ->> 'ar', 'ج.م') as "currencySymbol",
         coalesce(cx.decimals, c.currency_decimals, 2)::int as "currencyDecimals"
  from public.transactions t
  -- The row's own currency (recorded by the ledger) wins over its branch country's.
  left join lateral (
    select min(cc.currency_symbol ->> 'ar') as symbol, max(cc.currency_decimals) as decimals
    from public.countries cc where cc.currency = t.currency) cx on true
  left join public.businesses bz on bz.id = t.business_id
  left join public.orders o on o.id = t.order_id
  left join public.branches br on br.id = o.branch_id
  left join public.areas ar on ar.id = br.area_id
  left join public.countries c on c.code = ar.country_code
  left join lateral (
    select p.amount from public.payments p where p.order_id = t.order_id order by p.collected_at, p.id limit 1) p on true`;

export const financeRoutes = [
  route("GET", "/admin/finance/overview", async ({ query }) => {
    const sql = db();
    const raw = query.get("period");
    const period: FinancePeriod = raw === "today" || raw === "7d" ? raw : "30d";
    const country = query.get("country")?.trim().toUpperCase() || "";
    // Calendar days of the country's zone (else Cairo), not the server's (GAP-086).
    const { labels, starts, ends } = zoneDayRanges(PERIOD_DAYS[period], await reportZone(sql, country));
    const from = starts[0];
    const end = ends[ends.length - 1];
    const countryOnOrder =
      country && country !== "ALL"
        ? sql`exists (select 1 from public.branches br join public.areas ar on ar.id = br.area_id where br.id = o.branch_id and ar.country_code = ${country})`
        : sql`true`;
    // Commission is what the ledger RECORDED for each order (`transactions.commission`, at the rate of
    // that time — GAP-019), never recomputed with a wash's current rate. No ledger row → no commission.
    // Amounts in different currencies are never added together: the single-currency figures (headline
    // fields, curve, top washes) are in the report currency (the country's, else EGP) and the
    // *ByCurrency lists carry every currency.
    const currency = await reportCurrency(sql, country);
    const inCurrency = sql`${sql.unsafe(ORDER_CURRENCY)} = ${currency}`;
    const paid = sql`o.status = 'completed' and o.payment_status = 'paid' and ${countryOnOrder}`;
    // Settlements follow the country filter (wash located by its first branch) and carry their currency.
    const payoutInCountry =
      country && country !== "ALL"
        ? sql`and exists (select 1 from public.branches br join public.areas ar on ar.id = br.area_id
                          where br.business_id = po.business_id and ar.country_code = ${country})`
        : sql``;

    const [daily, [range], topWashes] = await Promise.all([
      sql<{ gmv: number; commission: number; orders: number }[]>`
        select coalesce(sum(o.total), 0) as gmv, coalesce(sum(t.commission), 0) as commission, count(o.id)::int as orders
        from unnest(${starts}::timestamptz[], ${ends}::timestamptz[]) with ordinality as d(s, e, i)
        left join (public.orders o ${sql.unsafe(ORDER_MONEY_JOIN)})
          on o.scheduled_at >= d.s and o.scheduled_at < d.e and ${paid} and ${inCurrency}
        group by d.i order by d.i`,
      sql<{ refunds: number; pendingPayouts: number; discrepancies: number }[]>`
        select coalesce((select sum(o.total) from public.orders o ${sql.unsafe(ORDER_MONEY_JOIN)}
                         where o.scheduled_at >= ${from} and o.scheduled_at < ${end} and o.payment_status = 'refunded'
                           and ${countryOnOrder} and ${inCurrency}), 0) as refunds,
               coalesce((select sum(po.amount_due - po.amount_paid) from public.payouts po
                         where po.status = 'due' and coalesce(po.currency, 'EGP') = ${currency} ${payoutInCountry}), 0) as "pendingPayouts",
               (select count(*)::int from public.transactions where flag = 'discrepancy') as discrepancies`,
      sql<{ id: string; name: FinanceOverview["topWashes"][number]["name"]; gmv: number; commission: number; orders: number }[]>`
        select b.id, b.name, sum(o.total) as gmv, coalesce(sum(t.commission), 0) as commission, count(*)::int as orders
        from public.orders o ${sql.unsafe(ORDER_MONEY_JOIN)}
        join public.businesses b on b.id = o.business_id
        where o.scheduled_at >= ${from} and o.scheduled_at < ${end} and ${paid} and ${inCurrency}
        group by b.id
        having sum(o.total) > 0
        order by gmv desc, b.id
        limit 6`,
    ]);

    // Symbol/decimals of a currency code (countries sharing a currency share them).
    const MONEY = `(select min(c.currency_symbol ->> 'ar') from public.countries c where c.currency = w.code) as symbol,
                   coalesce((select max(c.currency_decimals) from public.countries c where c.currency = w.code), 2)::int as decimals`;
    const [refundsByCurrency, payoutsByCurrency, byCurrency] = await Promise.all([
      sql<{ code: string; symbol: string; decimals: number; amount: number }[]>`
        with w as (
          select ${sql.unsafe(ORDER_CURRENCY)} as code, sum(o.total) as amount
          from public.orders o ${sql.unsafe(ORDER_MONEY_JOIN)}
          where o.scheduled_at >= ${from} and o.scheduled_at < ${end} and o.payment_status = 'refunded' and ${countryOnOrder}
          group by 1)
        select w.code, ${sql.unsafe(MONEY)}, w.amount from w order by w.code`,
      sql<{ code: string; symbol: string; decimals: number; due: number }[]>`
        with w as (
          select coalesce(po.currency, 'EGP') as code, sum(po.amount_due - po.amount_paid) as due
          from public.payouts po
          where po.status = 'due' ${payoutInCountry}
          group by 1)
        select w.code, ${sql.unsafe(MONEY)}, w.due from w order by w.code`,
      sql<{ code: string; symbol: string; decimals: number; gmv: number; commission: number; orders: number }[]>`
        with w as (
          select ${sql.unsafe(ORDER_CURRENCY)} as code, sum(o.total) as gmv, coalesce(sum(t.commission), 0) as commission, count(*)::int as orders
          from public.orders o ${sql.unsafe(ORDER_MONEY_JOIN)}
          where o.scheduled_at >= ${from} and o.scheduled_at < ${end} and ${paid}
          group by 1)
        select w.code, ${sql.unsafe(MONEY)}, w.gmv, w.commission, w.orders from w order by w.code`,
    ]);

    const gmv = daily.reduce((s, d) => s + d.gmv, 0);
    const commission = round2(daily.reduce((s, d) => s + d.commission, 0));
    const paidOrders = daily.reduce((s, d) => s + d.orders, 0);

    const overview: FinanceOverview = {
      period,
      currency,
      gmv,
      commission,
      netToWashes: round2(gmv - commission),
      refunds: range.refunds,
      paidOrders,
      averageOrderValue: paidOrders ? Math.round(gmv / paidOrders) : 0,
      pendingPayouts: range.pendingPayouts,
      discrepancies: range.discrepancies,
      series: labels.map((label, i) => ({
        label,
        date: starts[i],
        gmv: daily[i].gmv,
        commission: round2(daily[i].commission),
      })),
      topWashes: topWashes.map((w) => ({ ...w, commission: round2(w.commission) })),
      byCurrency: byCurrency.map((c) => ({ ...c, commission: round2(c.commission) })),
      refundsByCurrency,
      payoutsByCurrency,
    };
    return ok(overview);
  }),

  route("GET", "/admin/finance/transactions", async ({ query }) => {
    const sql = db();
    const filter = query.get("filter");
    const washId = query.get("washId");
    const country = query.get("country")?.trim().toUpperCase() || "";
    const search = searchPattern(query);

    const base = sql`
      ${TXN_ITEM(sql)}
      where true
        ${country && country !== "ALL" ? sql`and ar.country_code = ${country}` : sql``}
        ${washId && washId !== "all" ? sql`and t.business_id = ${washId}` : sql``}
        ${search ? sql`and (o.number ilike ${search} or bz.name ->> 'ar' ilike ${search} or bz.name ->> 'en' ilike ${search} or t.id ilike ${search})` : sql``}`;
    const where =
      filter === "discrepancy"
        ? sql`where w.flag = 'discrepancy'`
        : filter && filter !== "all"
          ? sql`where w.status = ${filter}`
          : sql``;

    const [countRows, [{ discrepancy }], [totals], totalsByCurrency] = await Promise.all([
      sql<{ k: string; n: number }[]>`with w as (${base}) select w.status::text as k, count(*)::int as n from w group by w.status`,
      sql<{ discrepancy: number }[]>`with w as (${base}) select count(*)::int as discrepancy from w where w.flag = 'discrepancy'`,
      sql<{ total: number; gross: number; commission: number; netToWash: number }[]>`
        with w as (${base})
        select count(*)::int as total, coalesce(sum(w.gross), 0) as gross, coalesce(sum(w.commission), 0) as commission,
               coalesce(sum(w."netToWash"), 0) as "netToWash"
        from w ${where}`,
      sql<{ symbol: string; decimals: number; gross: number; commission: number; netToWash: number }[]>`
        with w as (${base})
        select w."currencySymbol" as symbol, w."currencyDecimals"::int as decimals,
               coalesce(sum(w.gross), 0) as gross, coalesce(sum(w.commission), 0) as commission,
               coalesce(sum(w."netToWash"), 0) as "netToWash"
        from w ${where}
        group by w."currencySymbol", w."currencyDecimals"
        order by w."currencySymbol"`,
    ]);
    const sort = orderBy(
      sql,
      query,
      { date: "w.date", gross: "w.gross", commission: "w.commission", net: `w."netToWash"` },
      { key: "date", order: "desc" },
      "w.id",
    );
    const { items, pagination } = await paged(query, totals.total, 15, (limit, offset) =>
      sql<TransactionListItem[]>`with w as (${base}) select * from w ${where} ${sort} limit ${limit} offset ${offset}`,
    );
    return ok(items, "OK", {
      pagination,
      meta: {
        counts: { ...countsOf(countRows, TXN_STATUSES), discrepancy },
        totals: { gross: totals.gross, commission: round2(totals.commission), netToWash: round2(totals.netToWash) },
        totalsByCurrency: totalsByCurrency.map((c) => ({ ...c, commission: round2(c.commission), netToWash: round2(c.netToWash) })),
      },
    });
  }),

  route("GET", "/admin/finance/transactions/:id", async ({ params }) => {
    const sql = db();
    const [transaction] = await sql<TransactionListItem[]>`${TXN_ITEM(sql)} where t.id = ${params.id}`;
    if (!transaction) throw new MockApiError("المعاملة غير موجود", 404);

    const [[order], [payment], auditLogs] = await Promise.all([
      sql<{ total: number }[]>`select total from public.orders where id = ${transaction.orderId}`,
      sql<{ amount: number; collectedBy: string | null; collectedAt: string }[]>`
        select amount, collected_by as "collectedBy", collected_at as "collectedAt"
        from public.payments where order_id = ${transaction.orderId} order by collected_at, id limit 1`,
      auditWhere(sql, sql`al.entity_id in (${transaction.id}, ${transaction.orderId})`, sql`order by al.at desc`),
    ]);
    const cashier = payment?.collectedBy ? ((await actorNames(sql, [payment.collectedBy])).get(payment.collectedBy) ?? null) : null;

    const details: DiscrepancyDetails = {
      transaction,
      orderTotal: order?.total ?? transaction.gross,
      collected: payment?.amount ?? 0,
      difference: round2((payment?.amount ?? 0) - (order?.total ?? transaction.gross)),
      cashier,
      collectedAt: payment?.collectedAt ?? null,
      auditLogs,
    };
    return ok(details);
  }),

  route("POST", "/admin/finance/transactions/:id/resolve", async ({ params, body, admin }) => {
    const txn = await tx(async (t) => {
      const [current] = await transactionsWhere(t, t`t.id = ${params.id}`);
      if (!current) throw new MockApiError("المعاملة غير موجود", 404);
      if (current.flag !== "discrepancy") throw new MockApiError("هذه المعاملة لا تحتوي على فرق مفتوح", 409);
      const note = requireText(body.note, "note", "ملاحظة المراجعة", 5);

      // Flag guard in the WHERE clause: a concurrent resolve can't apply twice.
      const updated = await t`
        update public.transactions set flag = null, review_note = ${note}
        where id = ${current.id} and flag = 'discrepancy' returning id`;
      if (!updated.length) throw new MockApiError("هذه المعاملة لا تحتوي على فرق مفتوح", 409);
      await logAudit(t, {
        actorId: admin.id,
        action: "resolve_discrepancy",
        entity: "transactions",
        entityId: current.id,
        oldValue: "discrepancy",
        newValue: "reviewed",
        reason: note,
      });
      const [after] = await transactionsWhere(t, t`t.id = ${current.id}`);
      return after as Transaction;
    });
    return ok(txn, "تم تعليم الفرق كمُراجَع");
  }),

  route("GET", "/admin/finance/commission", async ({ query }) => {
    const sql = db();
    const from = daysAgo(29).toISOString();
    const country = query.get("country")?.trim().toUpperCase() || "";
    const [defaultPct, washes] = await Promise.all([
      defaultCommissionPct(sql),
      sql<{ id: string; name: CommissionSettings["washes"][number]["name"]; commissionRate: number | null; gmv30d: number; currencySymbol: string; currencyDecimals: number }[]>`
        select b.id, b.name, b.commission_rate as "commissionRate",
               coalesce(loc.symbol, 'ج.م') as "currencySymbol",
               coalesce(loc.decimals, 2)::int as "currencyDecimals",
               coalesce((select sum(o.total) from public.orders o
                         where o.business_id = b.id and o.status = 'completed' and o.payment_status = 'paid' and o.scheduled_at >= ${from}), 0) as "gmv30d"
        from public.businesses b
        left join lateral (
          select c.currency_symbol ->> 'ar' as symbol, c.currency_decimals as decimals, ar.country_code
          from public.branches br
          join public.areas ar on ar.id = br.area_id
          join public.countries c on c.code = ar.country_code
          where br.business_id = b.id
          order by br.id
          limit 1
        ) loc on true
        where b.status <> 'rejected'
          ${country && country !== "ALL" ? sql`and loc.country_code = ${country}` : sql``}
        order by b.created_at, b.id`,
    ]);
    const settings: CommissionSettings = {
      defaultCommissionPct: defaultPct,
      washes: washes.map((b) => ({
        id: b.id,
        name: b.name,
        rate: b.commissionRate ?? defaultPct,
        isOverride: b.commissionRate !== null,
        gmv30d: b.gmv30d,
        currencySymbol: b.currencySymbol,
        currencyDecimals: b.currencyDecimals,
      })),
    };
    return ok(settings);
  }),

  route("PUT", "/admin/finance/commission", async ({ body, admin }) => {
    await tx(async (t) => {
      const reason = requireText(body.reason, "reason", "سبب التعديل", 5);
      const nextDefault = Number(body.defaultCommissionPct);
      if (Number.isNaN(nextDefault) || nextDefault < 0 || nextDefault > 30) {
        throw new MockApiError("العمولة الافتراضية يجب أن تكون بين 0 و 30٪", 422);
      }
      const overrides = (body.overrides ?? {}) as Record<string, number | null>;
      const currentDefault = await defaultCommissionPct(t);
      const changes: string[] = [];

      if (nextDefault !== currentDefault) {
        await logAudit(t, {
          actorId: admin.id,
          action: "update_default_commission",
          entity: "settings",
          entityId: "commission",
          oldValue: `${currentDefault}%`,
          newValue: `${nextDefault}%`,
          reason,
        });
        await t`
          insert into public.platform_settings (key, value, updated_by, updated_at)
          values ('commission', ${t.json({ defaultPct: nextDefault })}, ${admin.id}, now())
          on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
        changes.push("default");
      }

      const ids = Object.keys(overrides);
      const businesses = ids.length ? await businessesWhere(t, t`b.id = any(${ids})`) : [];
      const byId = new Map(businesses.map((b) => [b.id, b]));
      for (const [bizId, raw] of Object.entries(overrides)) {
        const biz = byId.get(bizId);
        if (!biz) continue;
        const next = raw === null ? null : Number(raw);
        if (next !== null && (Number.isNaN(next) || next < 0 || next > 30)) {
          throw new MockApiError(`نسبة غير صالحة لـ ${biz.name.ar}`, 422);
        }
        if (next === biz.commissionRate) continue;
        await logAudit(t, {
          actorId: admin.id,
          action: "update_commission_override",
          entity: "businesses",
          entityId: biz.id,
          oldValue: biz.commissionRate === null ? "default" : `${biz.commissionRate}%`,
          newValue: next === null ? "default" : `${next}%`,
          reason,
        });
        await setCommissionRate(t, biz.id, next, nextDefault);
        changes.push(bizId);
      }
      // Throwing rolls back the transaction, so nothing above is kept.
      if (!changes.length) throw new MockApiError("لا توجد تغييرات للحفظ", 422);
    });
    return ok(null, "تم حفظ العمولة — تُطبق على المعاملات الجديدة فقط");
  }),

  route("GET", "/admin/finance/payouts", async ({ query }) => {
    const sql = db();
    const status = query.get("status");
    const country = query.get("country")?.trim().toUpperCase() || "";
    const search = searchPattern(query);

    const base = sql`
      select ${sql.unsafe(PAYOUT_COLS)}, coalesce(bz.name, '{"ar":"—","en":"—"}'::jsonb) as "businessName",
             coalesce(cx.symbol, loc.symbol, 'ج.م') as "currencySymbol", coalesce(cx.decimals, loc.decimals, 2)::int as "currencyDecimals"
      from public.payouts po
      left join public.businesses bz on bz.id = po.business_id
      -- The statement's own currency (GAP-020/011) wins over its wash's first-branch country.
      left join lateral (
        select min(cc.currency_symbol ->> 'ar') as symbol, max(cc.currency_decimals) as decimals
        from public.countries cc where cc.currency = po.currency) cx on true
      left join lateral (
        select c.currency_symbol ->> 'ar' as symbol, c.currency_decimals as decimals, ar.country_code
        from public.branches br
        join public.areas ar on ar.id = br.area_id
        join public.countries c on c.code = ar.country_code
        where br.business_id = po.business_id
        order by br.id
        limit 1
      ) loc on true
      where true
        ${country && country !== "ALL" ? sql`and loc.country_code = ${country}` : sql``}
        ${search ? sql`and (bz.name ->> 'ar' ilike ${search} or bz.name ->> 'en' ilike ${search} or po.reference ilike ${search})` : sql``}`;
    const filter = status && status !== "all" ? sql`where w.status = ${status}` : sql``;

    const [countRows, [totals], [{ total }], totalsByCurrency] = await Promise.all([
      sql<{ k: string; n: number }[]>`with w as (${base}) select w.status::text as k, count(*)::int as n from w group by w.status`,
      sql<{ due: number; paid: number }[]>`
        with w as (${base})
        select coalesce(sum(w."amountDue" - w."amountPaid") filter (where w.status = 'due'), 0) as due,
               coalesce(sum(w."amountPaid"), 0) as paid
        from w`,
      sql<{ total: number }[]>`with w as (${base}) select count(*)::int as total from w ${filter}`,
      sql<{ symbol: string; decimals: number; due: number; paid: number }[]>`
        with w as (${base})
        select w."currencySymbol" as symbol, w."currencyDecimals"::int as decimals,
               coalesce(sum(w."amountDue" - w."amountPaid") filter (where w.status = 'due'), 0) as due,
               coalesce(sum(w."amountPaid"), 0) as paid
        from w
        group by w."currencySymbol", w."currencyDecimals"
        order by w."currencySymbol"`,
    ]);
    const sort = orderBy(sql, query, { periodEnd: `w."periodEnd"`, amountDue: `w."amountDue"` }, { key: "periodEnd", order: "desc" }, "w.id");
    const { items, pagination } = await paged(query, total, 15, (limit, offset) =>
      sql<PayoutListItem[]>`with w as (${base}) select * from w ${filter} ${sort} limit ${limit} offset ${offset}`,
    );
    return ok(items, "OK", { pagination, meta: { counts: countsOf(countRows, ["due", "paid"] as const), totals, totalsByCurrency } });
  }),

  route("POST", "/admin/finance/payouts/:id/pay", async ({ params, body, admin }) => {
    const payout = await tx(async (t) => {
      // Row lock: concurrent payments of the same payout are applied one after the other (GAP-092).
      await t`select 1 from public.payouts where id = ${params.id} for update`;
      const [current] = await payoutsWhere(t, t`po.id = ${params.id}`);
      if (!current) throw new MockApiError("الدفعة غير موجود", 404);
      if (current.status === "paid") throw new MockApiError("تم سداد هذه الدفعة مسبقًا", 409);
      const { amount, total } = payoutIncrement(current, body);
      const reference = requireText(body.reference, "reference", "المرجع", 4);
      const date = typeof body.date === "string" && body.date ? new Date(body.date).toISOString() : now().toISOString();
      const status: Payout["status"] = total >= current.amountDue ? "paid" : "due";
      const code = current.currency || "EGP";
      const [money] = await t<{ symbol: string | null }[]>`
        select min(currency_symbol ->> 'ar') as symbol from public.countries where currency = ${code}`;
      const symbol = money?.symbol || code;

      // Status guard in the WHERE clause: a payout can't be paid twice concurrently.
      const updated = await t`
        update public.payouts set amount_paid = ${total}, reference = ${reference}, paid_at = ${date}, status = ${status}
        where id = ${current.id} and status = 'due' returning id`;
      if (!updated.length) throw new MockApiError("تم سداد هذه الدفعة مسبقًا", 409);

      // Fully collected: exactly the ledger rows of this statement are settled (GAP-020), never a
      // period-based guess. Only the status changes; the ledger rows themselves are the trigger's.
      let settled = 0;
      if (status === "paid") {
        const rows = await t`
          update public.transactions set status = 'settled'
          where payout_id = ${current.id} and status = 'paid'
          returning id`;
        settled = rows.length;
      }
      await logAudit(t, {
        actorId: admin.id,
        action: "mark_payout_paid",
        entity: "payouts",
        entityId: current.id,
        oldValue: "due",
        newValue: status,
        reason: `Reference: ${reference} — collected ${amount} ${code} (total ${total} of ${current.amountDue})${settled ? ` (تسوية ${settled} معاملة)` : ""}`,
      });
      // A settlement is commission the wash owes Wash Up: this records what was collected from it.
      await pushVendorNotification(
        t,
        current.businessId,
        null,
        "payout",
        status === "paid" ? "تمت تسوية عمولة الفترة" : "تم استلام دفعة من عمولة الفترة",
        `استلمت Wash Up ${amount.toLocaleString("en-US")} ${symbol} من عمولة الفترة — المرجع ${reference}.${status === "paid" ? "" : ` المتبقي ${round2(current.amountDue - total).toLocaleString("en-US")} ${symbol}.`}`,
        "/finance",
      );
      const [after] = await payoutsWhere(t, t`po.id = ${current.id}`);
      return after;
    });
    return ok(payout, payout.status === "paid" ? "تم تحصيل العمولة كاملة وتسوية معاملات الفترة" : "تم تسجيل تحصيل جزئي");
  }),

  // GAP-020: builds the settlement statements of a period (one per wash and currency) from paid,
  // not-yet-settled ledger rows, in the database (`generate_settlements`, postgres role only).
  route("POST", "/admin/finance/payouts/generate", async ({ body, admin }) => {
    const { start, end, reason } = settlementPeriod(body);
    const count = await tx(async (t) => {
      const [row] = await t<{ n: number }[]>`select public.generate_settlements(${start}::date, ${end}::date) as n`;
      await logAudit(t, {
        actorId: admin.id,
        action: "generate_settlements",
        entity: "payouts",
        entityId: `${start}..${end}`,
        newValue: `${row.n} statements`,
        reason,
      });
      return row.n;
    });
    return ok({ created: count }, count ? `تم إنشاء ${count} تسوية للفترة ${start} – ${end}` : "لا توجد معاملات مدفوعة غير مُسوّاة في هذه الفترة");
  }),
];
