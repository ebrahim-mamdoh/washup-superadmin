import "server-only";

import { now } from "../../db";
import { zoneDateParts, zoneLocalToUtc } from "../../shared/time";
import type { Q } from "../sql";

/** Default reporting zone: the platform started in Egypt. */
export const DEFAULT_REPORT_ZONE = "Africa/Cairo";

/**
 * Time zone the admin reports bucket days in (GAP-086): the filtered country's zone, else Cairo.
 * Never the server process zone (UTC on Vercel), so "today" matches the country's calendar day.
 */
export async function reportZone(q: Q, country = ""): Promise<string> {
  if (!country || country === "ALL") return DEFAULT_REPORT_ZONE;
  const [row] = await q<{ timezone: string | null }[]>`select timezone from public.countries where code = ${country}`;
  return row?.timezone || DEFAULT_REPORT_ZONE;
}

/**
 * The last `days` calendar days in `zone` (oldest → newest) as [start, end) ISO bounds plus a
 * `d/m` label and the day's start instant.
 */
export function zoneDayRanges(days: number, zone: string) {
  const today = zoneDateParts(now(), zone);
  const offsets = Array.from({ length: days }, (_, i) => days - 1 - i);
  const startOf = (back: number) => zoneLocalToUtc(zone, today.y, today.m, today.day - back, 0, 0);
  const starts = offsets.map((back) => startOf(back).toISOString());
  const ends = offsets.map((back) => startOf(back - 1).toISOString());
  const labels = offsets.map((back) => {
    const d = new Date(Date.UTC(today.y, today.m - 1, today.day - back));
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  });
  return { starts, ends, labels };
}

/**
 * Currency the single-series figures (curves, sparks, headline totals) are reported in: the filtered
 * country's currency, else EGP. Amounts in different currencies are never added together; the
 * per-currency breakdowns (`moneyByCurrency`, `byCurrency`) list every currency.
 */
export async function reportCurrency(q: Q, country = ""): Promise<string> {
  if (!country || country === "ALL") return DEFAULT_REPORT_CURRENCY;
  const [row] = await q<{ currency: string | null }[]>`select currency from public.countries where code = ${country}`;
  return row?.currency || DEFAULT_REPORT_CURRENCY;
}

export const DEFAULT_REPORT_CURRENCY = "EGP";

/**
 * Joins (after `public.orders o`) giving each order its ledger row `t` (one per order) and its branch
 * country's currency `oc`; `ORDER_CURRENCY` is then the order's currency (ledger first).
 */
export const ORDER_MONEY_JOIN = `left join public.transactions t on t.order_id = o.id
  left join lateral (
    select c2.currency from public.branches b2
    join public.areas a2 on a2.id = b2.area_id
    join public.countries c2 on c2.code = a2.country_code
    where b2.id = o.branch_id) oc on true`;
export const ORDER_CURRENCY = `coalesce(t.currency, oc.currency, 'EGP')`;
