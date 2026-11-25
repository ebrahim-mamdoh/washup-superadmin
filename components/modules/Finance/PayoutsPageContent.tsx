"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, CircleCheckBig, HandCoins, Wallet } from "lucide-react";

import { FinanceMetricCard } from "@/components/modules/Finance/FinanceMetricCard";
import { GenerateSettlementsButton } from "@/components/modules/Finance/GenerateSettlementsButton";
import { MarkPayoutPaidDialog } from "@/components/modules/Finance/MarkPayoutPaidDialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/export-csv-button";
import { FilterTabs } from "@/components/shared/filter-tabs";
import { ListToolbar } from "@/components/shared/list-toolbar";
import { CountryFilter } from "@/components/shared/country-filter";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { StatusBadge } from "@/components/shared/status-badge";
import { TablePagination } from "@/components/shared/table-pagination";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePayouts } from "@/hooks/use-finance";
import { useUrlState } from "@/hooks/use-url-state";
import { useCan } from "@/lib/admin-access";
import { PAYOUT_STATUS } from "@/lib/constants/labels";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import type { CsvColumn } from "@/lib/export-csv";
import type { PayoutListItem, PayoutStatus } from "@/types/finance";

const TAB_ORDER: (PayoutStatus | "all")[] = ["all", "due", "paid"];

const remainingOf = (p: PayoutListItem) => Math.max(0, p.amountDue - p.amountPaid);

const CSV: CsvColumn<PayoutListItem>[] = [
  { header: "المعرف", value: (p) => p.id },
  { header: "المغسلة", value: (p) => p.businessName.ar },
  { header: "بداية الفترة", value: (p) => p.periodStart.slice(0, 10) },
  { header: "نهاية الفترة", value: (p) => p.periodEnd.slice(0, 10) },
  { header: "العمولة المستحقة", value: (p) => p.amountDue },
  { header: "المحصّل", value: (p) => p.amountPaid },
  { header: "المتبقي", value: (p) => remainingOf(p) },
  { header: "الحالة", value: (p) => PAYOUT_STATUS[p.status].label },
  { header: "المرجع", value: (p) => p.reference },
  { header: "العملة", value: (p) => p.currency ?? "" },
  { header: "تاريخ آخر تحصيل", value: (p) => (p.paidAt ? p.paidAt.slice(0, 10) : "") },
];

function buildColumns(onPay: (p: PayoutListItem) => void, canManage: boolean): DataTableColumn<PayoutListItem>[] {
  return [
    {
      key: "wash",
      header: "المغسلة",
      cell: (p) => (
        <Link href={`/washes/${p.businessId}`} className="group/link flex min-w-0 items-center gap-3">
          <span className="bg-brand-gradient flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white">
            {p.businessName.en.slice(0, 2).toUpperCase()}
          </span>
          <span className="truncate font-semibold group-hover/link:text-primary">{p.businessName.ar}</span>
        </Link>
      ),
    },
    {
      key: "period",
      header: "الفترة",
      sortKey: "periodEnd",
      cell: (p) => (
        <span className="num text-xs whitespace-nowrap">
          {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
        </span>
      ),
    },
    { key: "due", header: "العمولة المستحقة", sortKey: "amountDue", align: "end", cell: (p) => <span className="num font-semibold">{formatMoney(p.amountDue, p.currencySymbol ? { symbol: p.currencySymbol, fractionDigits: p.currencyDecimals ?? 2 } : undefined)}</span> },
    {
      key: "paid",
      header: "المحصّل",
      align: "end",
      hideBelow: "md",
      cell: (p) => <span className="num text-muted-foreground">{formatMoney(p.amountPaid, p.currencySymbol ? { symbol: p.currencySymbol, fractionDigits: p.currencyDecimals ?? 2 } : undefined)}</span>,
    },
    {
      key: "remaining",
      header: "المتبقي",
      align: "end",
      cell: (p) => {
        const r = remainingOf(p);
        return r > 0 ? (
          <span className="num font-semibold text-warning">
            {formatMoney(r, p.currencySymbol ? { symbol: p.currencySymbol, fractionDigits: p.currencyDecimals ?? 2 } : undefined)}
            {p.amountPaid > 0 ? <span className="block text-[11px] font-normal text-muted-foreground">تحصيل جزئي</span> : null}
          </span>
        ) : (
          <span className="num text-muted-foreground">{formatMoney(0, p.currencySymbol ? { symbol: p.currencySymbol, fractionDigits: p.currencyDecimals ?? 2 } : undefined)}</span>
        );
      },
    },
    { key: "status", header: "الحالة", cell: (p) => <StatusBadge meta={PAYOUT_STATUS[p.status]} size="sm" /> },
    {
      key: "reference",
      header: "المرجع",
      hideBelow: "lg",
      cell: (p) =>
        p.reference ? (
          <span className="num rounded-md bg-muted px-1.5 py-0.5 text-xs" dir="ltr">
            {p.reference}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "paidAt",
      header: "آخر تحصيل",
      hideBelow: "xl",
      cell: (p) => <span className="num text-xs text-muted-foreground">{p.paidAt ? formatDateTime(p.paidAt) : "—"}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">إجراءات</span>,
      align: "end",
      cell: (p) =>
        p.status === "due" && canManage ? (
          <Button size="sm" onClick={() => onPay(p)}>
            <HandCoins />
            تسجيل تحصيل
          </Button>
        ) : null,
    },
  ];
}

export default function PayoutsPageContent() {
  const [state, setState] = useUrlState({
    status: "all",
    search: "",
    sort: "periodEnd",
    order: "desc",
    page: 1,
    country: "all",
  });
  const can = useCan();
  const [dialog, setDialog] = useState<{ payout: PayoutListItem | null; open: boolean }>({ payout: null, open: false });

  const { data, isLoading, isFetching, error, refetch } = usePayouts({
    status: state.status,
    search: state.search,
    sort: state.sort,
    order: state.order as "asc" | "desc",
    page: state.page,
    country: state.country,
  });

  const counts = data?.meta.counts;
  const totals = data?.meta.totals;
  const canManage = can("finance", "manage");
  const columns = buildColumns((payout) => setDialog({ payout, open: true }), canManage);

  return (
    <div className="space-y-6">
      <PageHeader
        title="تسويات العمولة"
        description="عمولة Wash Up المستحقة على كل مغسلة عن كل فترة (العملاء يدفعون للمغسلة مباشرة). سجّل ما تحصّله بالمرجع؛ التحصيل الكامل يُسوّي معاملات التسوية."
        actions={
          <>
            <CountryFilter value={state.country} onChange={(country) => setState({ country })} />
            <ExportCsvButton filename="carzen-payouts" columns={CSV} rows={data?.items} />
            {canManage ? <GenerateSettlementsButton /> : null}
          </>
        }
      />

      {error && !data ? null : (
        <div className="grid gap-3 sm:grid-cols-3">
          {totals && counts ? (
            <>
              <FinanceMetricCard
                label="عمولة لم تُحصّل"
                definition="إجمالي العمولة المتبقية على المغاسل في التسويات المفتوحة (المستحق ناقص المحصّل)."
                value={(data?.meta.totalsByCurrency?.length ? data.meta.totalsByCurrency : [{ symbol: "ج.م", decimals: 2, due: totals.due, paid: totals.paid }])
                  .map((c) => formatMoney(c.due, { symbol: c.symbol, fractionDigits: c.decimals }))
                  .join(" · ")}
                icon={<Wallet />}
                tone="var(--warning)"
                highlight={totals.due > 0}
                hint={`${formatNumber(counts.due)} تسوية مفتوحة`}
              />
              <FinanceMetricCard
                label="إجمالي المحصّل"
                definition="مجموع العمولة التي حصّلتها Wash Up من المغاسل في كل التسويات، بما فيها التحصيل الجزئي."
                value={(data?.meta.totalsByCurrency?.length ? data.meta.totalsByCurrency : [{ symbol: "ج.م", decimals: 2, due: totals.due, paid: totals.paid }])
                  .map((c) => formatMoney(c.paid, { symbol: c.symbol, fractionDigits: c.decimals }))
                  .join(" · ")}
                icon={<CircleCheckBig />}
                tone="var(--success)"
                hint={`${formatNumber(counts.paid)} تسوية محصّلة بالكامل`}
              />
              <FinanceMetricCard
                label="دورات التسوية"
                definition="عدد كشوف التسوية المسجلة لكل المغاسل (مفتوحة ومحصّلة)."
                value={formatNumber(counts.all)}
                icon={<CalendarClock />}
                tone="var(--primary)"
                hint="كل الفترات"
              />
            </>
          ) : (
            Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[106px] rounded-2xl" />)
          )}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-soft">
        <ListToolbar
          tabs={
            <FilterTabs
              aria-label="حالة التسوية"
              value={state.status as PayoutStatus | "all"}
              onChange={(status) => setState({ status })}
              items={TAB_ORDER.map((s) => ({
                value: s,
                label: s === "all" ? "الكل" : PAYOUT_STATUS[s].label,
                count: counts?.[s],
                tone: s === "all" ? undefined : PAYOUT_STATUS[s].tone,
              }))}
            />
          }
          search={<SearchInput value={state.search} onChange={(search) => setState({ search })} placeholder="ابحث باسم المغسلة أو المرجع" />}
        />
        <DataTable
          columns={columns}
          rows={data?.items}
          rowKey={(p) => p.id}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          onRetry={() => refetch()}
          sort={{ key: state.sort, order: state.order as "asc" | "desc" }}
          onSortChange={(s) => setState({ sort: s.key, order: s.order })}
          rowClassName={(p) => (p.status === "due" ? "bg-warning/[0.03]" : undefined)}
          empty={{
            icon: <Wallet />,
            title: state.status === "due" ? "لا توجد تسويات مفتوحة" : "لا توجد تسويات مطابقة",
            description: state.status === "due" ? "كل العمولات المستحقة محصّلة." : "جرّب حالة أخرى أو امسح كلمة البحث.",
          }}
          footer={<TablePagination pagination={data?.pagination} onPageChange={(page) => setState({ page }, { resetPage: false })} />}
        />
      </section>

      <MarkPayoutPaidDialog
        payout={dialog.payout}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  );
}
