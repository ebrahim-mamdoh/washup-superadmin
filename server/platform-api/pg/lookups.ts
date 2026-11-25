import "server-only";

import type { Localized } from "@/types/common";
import type { Order, OrderListItem } from "@/types/orders";

import { serviceName } from "../lookups";
import type { Q } from "./sql";

/**
 * Batch name lookups that turn loaded rows into list items — the Postgres
 * counterparts of `../lookups.ts`. One query per kind of name, never one per row.
 */
const EMPTY: Localized = { ar: "—", en: "—" };

async function namesById<T>(q: Q, table: "businesses" | "branches" | "customers" | "staff", ids: (string | null)[]): Promise<Map<string, T>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map();
  const rows = await q<{ id: string; name: T }[]>`select id, name from ${q("public." + table)} where id = any(${unique})`;
  return new Map(rows.map((r) => [r.id, r.name]));
}

export const businessNames = (q: Q, ids: (string | null)[]) => namesById<Localized>(q, "businesses", ids);
export const branchNames = (q: Q, ids: (string | null)[]) => namesById<Localized>(q, "branches", ids);
export const customerNames = (q: Q, ids: (string | null)[]) => namesById<string>(q, "customers", ids);

/** Admin name for audit/notes authors: admins, then staff, "النظام" for the seed actor. */
export async function actorNames(q: Q, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const rows = await q<{ id: string; name: string }[]>`
    select id, name from public.admin_users where id = any(${unique})
    union all
    select id, name from public.staff where id = any(${unique}) and id not in (select id from public.admin_users)`;
  for (const r of rows) map.set(r.id, r.name);
  if (unique.includes("seed")) map.set("seed", "النظام");
  return map;
}

/** Orders → admin list items (customer, business, branch, primary service names). */
export async function toOrderListItems(q: Q, orders: Order[]): Promise<OrderListItem[]> {
  const [customers, businesses, branches] = await Promise.all([
    customerNames(q, orders.map((o) => o.customerId)),
    businessNames(q, orders.map((o) => o.businessId)),
    branchNames(q, orders.map((o) => o.branchId)),
  ]);
  return orders.map((o) => ({
    ...o,
    customerName: (o.customerId && customers.get(o.customerId)) || null,
    businessName: businesses.get(o.businessId) ?? EMPTY,
    branchName: branches.get(o.branchId) ?? EMPTY,
    serviceName: serviceName(o),
  }));
}
