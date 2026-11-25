import "server-only";

import { now } from "../../db";
import { zoneDateParts, zoneLocalToUtc } from "../../vendor/engine";
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
