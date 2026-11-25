import "server-only";

import type {
  CommissionSettings,
  DiscrepancyDetails,
  FinanceOverview,
  FinancePeriod,
  PayoutListItem,
  TransactionListItem,
  TransactionStatus,
} from "@/types/finance";
import type { Transaction } from "@/types/finance";
import { daysAgo, isSameDay, logAudit, nid, now, round2 } from "../db";
import { MockApiError, countBy, matchesSearch, ok, paginate, requireText, sortBy } from "../http";
import { adminName, businessName, findOrThrow } from "../lookups";
import { payoutIncrement, settlementPeriod } from "../finance-rules";
import { route } from "../router";
import { pushVendorNotification } from "../vendor/notify";
import type { MockDatabase } from "../schema";

const TXN_STATUSES: TransactionStatus[] = ["pending", "paid", "refunded", "settled"];
const PERIOD_DAYS: Record<FinancePeriod, number> = { today: 1, "7d": 7, "30d": 30 };

function toTxnItem(db: MockDatabase, t: Transaction): TransactionListItem {
  const order = db.orders.find((o) => o.id === t.orderId);
  const payment = db.payments.find((p) => p.orderId === t.orderId);
  return {
    ...t,
    businessName: businessName(db, t.businessId),
    orderNumber: order?.number ?? "—",
    paymentMethod: order?.paymentMethod ?? null,
    collectedAmount: payment?.amount ?? null,
  };
}

/** The single way a wash's commission rate changes (GAP-089): stores it and tells the wash. */
export function setCommissionRate(db: MockDatabase, biz: MockDatabase["businesses"][number], next: number | null) {
  biz.commissionRate = next;
  pushVendorNotification(db, biz.id, null, "platform", "تحديث نسبة العمولة", `نسبة عمولة Wash Up على مغسلتك أصبحت ${next ?? db.defaultCommissionPct}٪ للمعاملات الجديدة.`, "/finance");
}

export const financeRoutes = [
  route("GET", "/admin/finance/overview", ({ db, query }) => {
    const raw = query.get("period");
    const period: FinancePeriod = raw === "today" || raw === "7d" ? raw : "30d";
    const days = PERIOD_DAYS[period];
    const from = daysAgo(days - 1);
    const end = new Date(now());
    end.setHours(23, 59, 59, 999);

    const inRange = db.orders.filter((o) => {
      const t = new Date(o.scheduledAt);
      return t >= from && t <= end;
    });
    const paid = inRange.filter((o) => o.status === "completed" && o.paymentStatus === "paid");
    // Commission RECORDED in the ledger for each order (rate of that time), not the current rate (GAP-019).
    const recorded = new Map(db.transactions.map((t) => [t.orderId, t.commission]));
    const commissionOf = (orders: typeof paid) => round2(orders.reduce((s, o) => s + (recorded.get(o.id) ?? 0), 0));
    const gmv = paid.reduce((s, o) => s + o.total, 0);
    const commission = commissionOf(paid);

    const series = Array.from({ length: days }, (_, i) => {
      const day = daysAgo(days - 1 - i);
      const dayPaid = paid.filter((o) => isSameDay(o.scheduledAt, day));
      const dayGmv = dayPaid.reduce((s, o) => s + o.total, 0);
      return {
        label: `${day.getDate()}/${day.getMonth() + 1}`,
        date: day.toISOString(),
        gmv: dayGmv,
        commission: commissionOf(dayPaid),
      };
    });

    const topWashes = db.businesses
      .map((b) => {
        const orders = paid.filter((o) => o.businessId === b.id);
        const g = orders.reduce((s, o) => s + o.total, 0);
        return { id: b.id, name: b.name, gmv: g, commission: commissionOf(orders), orders: orders.length };
      })
      .filter((w) => w.gmv > 0)
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 6);

    const overview: FinanceOverview = {
      period,
      currency: "EGP",
      gmv,
      commission,
      netToWashes: round2(gmv - commission),
      refunds: inRange.filter((o) => o.paymentStatus === "refunded").reduce((s, o) => s + o.total, 0),
      paidOrders: paid.length,
      averageOrderValue: paid.length ? Math.round(gmv / paid.length) : 0,
      pendingPayouts: db.payouts.filter((p) => p.status === "due").reduce((s, p) => s + p.amountDue - p.amountPaid, 0),
      discrepancies: db.transactions.filter((t) => t.flag === "discrepancy").length,
      series,
      topWashes,
    };
    return ok(overview);
  }),

  route("GET", "/admin/finance/transactions", ({ db, query }) => {
    const filter = query.get("filter");
    const washId = query.get("washId");
    const base = db.transactions
      .map((t) => toTxnItem(db, t))
      .filter((t) => (!washId || washId === "all" || t.businessId === washId) && matchesSearch(query, t.orderNumber, t.businessName.ar, t.businessName.en, t.id));
    const statusCounts = countBy(base, TXN_STATUSES, (t) => t.status);
    const counts = { ...statusCounts, discrepancy: base.filter((t) => t.flag === "discrepancy").length };
    const filtered =
      filter === "discrepancy"
        ? base.filter((t) => t.flag === "discrepancy")
        : filter && filter !== "all"
          ? base.filter((t) => t.status === filter)
          : base;
    const sorted = sortBy(filtered, query, { date: (t) => t.date, gross: (t) => t.gross, commission: (t) => t.commission, net: (t) => t.netToWash }, { key: "date", order: "desc" });
    const { items, pagination } = paginate(sorted, query, 15);
    return ok(items, "OK", {
      pagination,
      meta: {
        counts,
        totals: {
          gross: filtered.reduce((s, t) => s + t.gross, 0),
          commission: round2(filtered.reduce((s, t) => s + t.commission, 0)),
          netToWash: round2(filtered.reduce((s, t) => s + t.netToWash, 0)),
        },
      },
    });
  }),

  route("GET", "/admin/finance/transactions/:id", ({ db, params }) => {
    const txn = findOrThrow(db.transactions, params.id, "المعاملة");
    const order = db.orders.find((o) => o.id === txn.orderId);
    const payment = db.payments.find((p) => p.orderId === txn.orderId);
    const details: DiscrepancyDetails = {
      transaction: toTxnItem(db, txn),
      orderTotal: order?.total ?? txn.gross,
      collected: payment?.amount ?? 0,
      difference: round2((payment?.amount ?? 0) - (order?.total ?? txn.gross)),
      cashier: payment ? adminName(db, payment.collectedBy) : null,
      collectedAt: payment?.collectedAt ?? null,
      auditLogs: db.auditLogs.filter((a) => a.entityId === txn.id || a.entityId === txn.orderId),
    };
    return ok(details);
  }),

  route("POST", "/admin/finance/transactions/:id/resolve", ({ db, params, body, admin }) => {
    const txn = findOrThrow(db.transactions, params.id, "المعاملة");
    if (txn.flag !== "discrepancy") throw new MockApiError("هذه المعاملة لا تحتوي على فرق مفتوح", 409);
    const note = requireText(body.note, "note", "ملاحظة المراجعة", 5);
    txn.flag = null;
    txn.reviewNote = note;
    logAudit(db, { actorId: admin.id, action: "resolve_discrepancy", entity: "transactions", entityId: txn.id, oldValue: "discrepancy", newValue: "reviewed", reason: note });
    return ok(txn, "تم تعليم الفرق كمُراجَع");
  }),

  route("GET", "/admin/finance/commission", ({ db }) => {
    const from = daysAgo(29);
    const settings: CommissionSettings = {
      defaultCommissionPct: db.defaultCommissionPct,
      washes: db.businesses
        .filter((b) => b.status !== "rejected")
        .map((b) => ({
          id: b.id,
          name: b.name,
          rate: b.commissionRate ?? db.defaultCommissionPct,
          isOverride: b.commissionRate !== null,
          gmv30d: db.orders
            .filter((o) => o.businessId === b.id && o.status === "completed" && o.paymentStatus === "paid" && new Date(o.scheduledAt) >= from)
            .reduce((s, o) => s + o.total, 0),
        })),
    };
    return ok(settings);
  }),

  route("PUT", "/admin/finance/commission", ({ db, body, admin }) => {
    const reason = requireText(body.reason, "reason", "سبب التعديل", 5);
    const nextDefault = Number(body.defaultCommissionPct);
    if (Number.isNaN(nextDefault) || nextDefault < 0 || nextDefault > 30) {
      throw new MockApiError("العمولة الافتراضية يجب أن تكون بين 0 و 30٪", 422);
    }
    const overrides = (body.overrides ?? {}) as Record<string, number | null>;
    const changes: string[] = [];

    if (nextDefault !== db.defaultCommissionPct) {
      logAudit(db, { actorId: admin.id, action: "update_default_commission", entity: "settings", entityId: "commission", oldValue: `${db.defaultCommissionPct}%`, newValue: `${nextDefault}%`, reason });
      db.defaultCommissionPct = nextDefault;
      changes.push("default");
    }
    for (const [bizId, raw] of Object.entries(overrides)) {
      const biz = db.businesses.find((b) => b.id === bizId);
      if (!biz) continue;
      const next = raw === null ? null : Number(raw);
      if (next !== null && (Number.isNaN(next) || next < 0 || next > 30)) {
        throw new MockApiError(`نسبة غير صالحة لـ ${biz.name.ar}`, 422);
      }
      if (next === biz.commissionRate) continue;
      logAudit(db, { actorId: admin.id, action: "update_commission_override", entity: "businesses", entityId: biz.id, oldValue: biz.commissionRate === null ? "default" : `${biz.commissionRate}%`, newValue: next === null ? "default" : `${next}%`, reason });
      setCommissionRate(db, biz, next);
      changes.push(bizId);
    }
    if (!changes.length) throw new MockApiError("لا توجد تغييرات للحفظ", 422);
    return ok(null, "تم حفظ العمولة — تُطبق على المعاملات الجديدة فقط");
  }),

  route("GET", "/admin/finance/payouts", ({ db, query }) => {
    const status = query.get("status");
    const base: PayoutListItem[] = db.payouts
      .map((p) => ({ ...p, businessName: businessName(db, p.businessId) }))
      .filter((p) => matchesSearch(query, p.businessName.ar, p.businessName.en, p.reference));
    const counts = countBy(base, ["due", "paid"] as const, (p) => p.status);
    const filtered = status && status !== "all" ? base.filter((p) => p.status === status) : base;
    const sorted = sortBy(filtered, query, { periodEnd: (p) => p.periodEnd, amountDue: (p) => p.amountDue }, { key: "periodEnd", order: "desc" });
    const { items, pagination } = paginate(sorted, query, 15);
    return ok(items, "OK", {
      pagination,
      meta: {
        counts,
        totals: {
          due: base.filter((p) => p.status === "due").reduce((s, p) => s + p.amountDue - p.amountPaid, 0),
          paid: base.reduce((s, p) => s + p.amountPaid, 0),
        },
      },
    });
  }),

  route("POST", "/admin/finance/payouts/:id/pay", ({ db, params, body, admin }) => {
    const payout = findOrThrow(db.payouts, params.id, "الدفعة");
    if (payout.status === "paid") throw new MockApiError("تم سداد هذه الدفعة مسبقًا", 409);
    const { amount, total } = payoutIncrement(payout, body);
    const reference = requireText(body.reference, "reference", "المرجع", 4);
    const date = typeof body.date === "string" && body.date ? new Date(body.date).toISOString() : now().toISOString();

    payout.amountPaid = total;
    payout.reference = reference;
    payout.paidAt = date;
    payout.status = total >= payout.amountDue ? "paid" : "due";

    let settled = 0;
    if (payout.status === "paid") {
      for (const t of db.transactions) {
        // Exactly the ledger rows of this statement (GAP-020), not a period-based match.
        if (t.payoutId === payout.id && t.status === "paid") {
          t.status = "settled";
          settled += 1;
        }
      }
    }
    const code = payout.currency || "EGP";
    logAudit(db, { actorId: admin.id, action: "mark_payout_paid", entity: "payouts", entityId: payout.id, oldValue: "due", newValue: payout.status, reason: `Reference: ${reference} — collected ${amount} ${code} (total ${total} of ${payout.amountDue})${settled ? ` (تسوية ${settled} معاملة)` : ""}` });
    // A settlement is commission the wash owes Wash Up: this records what was collected from it.
    pushVendorNotification(db, payout.businessId, null, "payout", payout.status === "paid" ? "تمت تسوية عمولة الفترة" : "تم استلام دفعة من عمولة الفترة", `استلمت Wash Up ${amount.toLocaleString("en-US")} ج.م من عمولة الفترة — المرجع ${reference}.`, "/finance");
    return ok(payout, payout.status === "paid" ? "تم تحصيل العمولة كاملة وتسوية معاملات الفترة" : "تم تسجيل تحصيل جزئي");
  }),

  // GAP-020: one "due" statement per wash and currency from paid, unlinked ledger rows of the period
  // (same rule as the database's generate_settlements).
  route("POST", "/admin/finance/payouts/generate", ({ db, body, admin }) => {
    const { start, end, reason } = settlementPeriod(body);
    const from = Date.parse(`${start}T00:00:00.000Z`);
    const until = Date.parse(`${end}T00:00:00.000Z`) + 86_400_000;
    const groups = new Map<string, { businessId: string; currency: string; due: number; rows: typeof db.transactions }>();
    for (const t of db.transactions) {
      const at = Date.parse(t.date);
      if (t.status !== "paid" || t.payoutId || at < from || at >= until) continue;
      const currency = t.currency || "EGP";
      const key = `${t.businessId}|${currency}`;
      const g = groups.get(key) ?? { businessId: t.businessId, currency, due: 0, rows: [] };
      g.due += t.commission;
      g.rows.push(t);
      groups.set(key, g);
    }
    let created = 0;
    for (const g of groups.values()) {
      if (g.due <= 0) continue;
      const id = nid("po");
      db.payouts.push({ id, businessId: g.businessId, periodStart: `${start}T00:00:00.000Z`, periodEnd: `${end}T00:00:00.000Z`, amountDue: round2(g.due), amountPaid: 0, status: "due", reference: null, paidAt: null, currency: g.currency });
      for (const t of g.rows) t.payoutId = id;
      created += 1;
    }
    logAudit(db, { actorId: admin.id, action: "generate_settlements", entity: "payouts", entityId: `${start}..${end}`, newValue: `${created} statements`, reason });
    return ok({ created }, created ? `تم إنشاء ${created} تسوية للفترة ${start} – ${end}` : "لا توجد معاملات مدفوعة غير مُسوّاة في هذه الفترة");
  }),
];
