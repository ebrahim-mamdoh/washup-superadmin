import "server-only";

import type { PermissionKey, PermissionLevel, RolesMatrix } from "@/types/admins";
import type { AdminPermissions, AdminRole } from "@/types/auth";
import type { AdminNotificationType } from "@/types/notifications";
import type { SearchResultGroup } from "@/types/search";

import { DEFAULT_ROLES_MATRIX } from "./seed";

/**
 * Admin route permissions (GAP-012). Every `/admin/*` route is mapped to a module
 * of the roles matrix (`admin_role_permissions` on Postgres, `db.roles` in the mock)
 * and the level it needs: GET = view, writes = manage. Super keeps full access.
 *
 * - `"any"`: every signed-in active admin (own session, lookups, own devices).
 * - `"super"`: Super Admin only — managing admins and the matrix, demo reset, and any
 *   route missing from this table (fail closed).
 */
export type RouteAccess = { key: PermissionKey; level: "view" | "manage" } | "any" | "super";

const view = (key: PermissionKey): RouteAccess => ({ key, level: "view" });
const manage = (key: PermissionKey): RouteAccess => ({ key, level: "manage" });

const ROUTE_ACCESS: Record<string, RouteAccess> = {
  // Session
  "GET /admin/auth/me": "any",
  "POST /admin/auth/logout": "any",
  "POST /admin/push/register": "any",
  "POST /admin/push/unregister": "any",
  // Search filters its result groups by the caller's permissions.
  "GET /admin/search": "any",
  // Reference lists used by filters on several screens (country filter, area names).
  "GET /admin/countries": "any",
  "GET /admin/areas": "any",

  "GET /admin/dashboard": view("dashboard"),

  "GET /admin/washes": view("washes"),
  "GET /admin/washes/:id": view("washes"),
  "GET /admin/washes/:id/impact": view("washes"),
  "PATCH /admin/washes/:id": manage("washes"),
  "POST /admin/washes/:id/suspend": manage("washes"),
  "POST /admin/washes/:id/reactivate": manage("washes"),

  "GET /admin/branches": view("branches"),
  "POST /admin/branches/:id/toggle": manage("branches"),
  "PATCH /admin/branches/:id/location": manage("branches"),

  "GET /admin/staff": view("staff"),
  "POST /admin/staff/:id/status": manage("staff"),

  "GET /admin/applications": view("applications"),
  "GET /admin/applications/:id": view("applications"),
  "POST /admin/applications/:id/approve": manage("applications"),
  "POST /admin/applications/:id/reject": manage("applications"),
  "POST /admin/applications/:id/request-changes": manage("applications"),
  "POST /admin/applications/:id/owner-login": manage("applications"),

  "GET /admin/orders": view("orders"),
  "GET /admin/orders/:id": view("orders"),
  "POST /admin/orders/:id/cancel": manage("orders"),
  "POST /admin/orders/:id/flag": manage("orders"),

  "GET /admin/customers": view("customers"),
  "GET /admin/customers/:id": view("customers"),
  "POST /admin/customers/:id/status": manage("customers"),

  "GET /admin/complaints": view("complaints"),
  "GET /admin/complaints/:id": view("complaints"),
  "PATCH /admin/complaints/:id": manage("complaints"),

  "GET /admin/reviews": view("reviews"),
  "POST /admin/reviews/:id/visibility": manage("reviews"),

  "GET /admin/offers": view("offers"),
  "POST /admin/offers": manage("offers"),
  "PATCH /admin/offers/:id": manage("offers"),
  "POST /admin/offers/:id/status": manage("offers"),

  "GET /admin/finance/overview": view("finance"),
  "GET /admin/finance/transactions": view("finance"),
  "GET /admin/finance/transactions/:id": view("finance"),
  "POST /admin/finance/transactions/:id/resolve": manage("finance"),
  "GET /admin/finance/commission": view("finance"),
  "PUT /admin/finance/commission": manage("finance"),
  "GET /admin/finance/payouts": view("finance"),
  "POST /admin/finance/payouts/:id/pay": manage("finance"),
  "POST /admin/finance/payouts/generate": manage("finance"),

  // Admin accounts and the matrix: viewable per the matrix, managed by Super Admin only.
  "GET /admin/admins": view("admins"),
  "POST /admin/admins": "super",
  "PATCH /admin/admins/:id": "super",
  "POST /admin/admins/:id/status": "super",
  "GET /admin/roles": view("roles"),
  "PUT /admin/roles": "super",

  "GET /admin/settings": view("settings"),
  "PUT /admin/settings/:section": manage("settings"),
  "POST /admin/areas": manage("settings"),
  "PATCH /admin/areas/:id": manage("settings"),
  "PATCH /admin/countries/:code": manage("settings"),

  "GET /admin/audit": view("audit"),

  "GET /admin/notifications": view("notifications"),
  "POST /admin/notifications/:id/read": view("notifications"),
  "POST /admin/notifications/read-all": view("notifications"),

  "POST /admin/system/reset": "super",
};

/** Access rule of a matched route (`path` is the route pattern, e.g. `/admin/washes/:id`). Unmapped → super only. */
export function routeAccess(method: string, path: string): RouteAccess {
  return ROUTE_ACCESS[`${method.toUpperCase()} ${path}`] ?? "super";
}

export const PERMISSION_KEYS = Object.keys(DEFAULT_ROLES_MATRIX.super) as PermissionKey[];
const LEVEL_RANK: Record<PermissionLevel, number> = { none: 0, view: 1, manage: 2 };

/** Permissions of a role: super is fixed (full); other roles read the stored matrix (missing keys = none). */
export function permissionsFor(role: AdminRole, matrix: Partial<RolesMatrix> | null): AdminPermissions {
  if (role === "super") return { ...DEFAULT_ROLES_MATRIX.super };
  const row: Partial<Record<PermissionKey, PermissionLevel>> = matrix?.[role] ?? {};
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, row[k] ?? "none"])) as AdminPermissions;
}

export function hasLevel(permissions: AdminPermissions, key: PermissionKey, level: "view" | "manage"): boolean {
  return LEVEL_RANK[permissions[key] ?? "none"] >= LEVEL_RANK[level];
}

export function canAccess(role: AdminRole, permissions: AdminPermissions, access: RouteAccess): boolean {
  if (role === "super") return true;
  if (access === "any") return true;
  if (access === "super") return false;
  return hasLevel(permissions, access.key, access.level);
}

export const FORBIDDEN = "ليست لديك صلاحية لهذا الإجراء";

/** Module an admin notification belongs to (null: everyone with the notifications permission sees it). */
export const NOTIFICATION_MODULE: Record<AdminNotificationType, PermissionKey | null> = {
  application: "applications",
  complaint: "complaints",
  critical_review: "reviews",
  payment_issue: "finance",
  finance_flag: "finance",
  unusual_activity: null,
  system: null,
};

/** Notification types this admin may see (all for super). */
export function visibleNotificationTypes(permissions: AdminPermissions): AdminNotificationType[] {
  return (Object.keys(NOTIFICATION_MODULE) as AdminNotificationType[]).filter((t) => {
    const key = NOTIFICATION_MODULE[t];
    return key === null || hasLevel(permissions, key, "view");
  });
}

/** Module whose view permission a global-search result group needs. */
export const SEARCH_GROUP_MODULE: Record<SearchResultGroup, PermissionKey> = {
  customers: "customers",
  plates: "customers",
  washes: "washes",
  branches: "washes",
  orders: "orders",
  complaints: "complaints",
};
