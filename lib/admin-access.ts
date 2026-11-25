"use client";

import { useAuthStore } from "@/lib/store/auth-store";
import type { PermissionKey } from "@/types/admins";
import type { AdminSession } from "@/types/auth";

/**
 * Client view of the signed-in admin's permissions (GAP-012). This only hides what the admin
 * can't use; the API enforces the same matrix on every request. Super Admin sees everything.
 * A session persisted before permissions existed has none until `/auth/me` refreshes it.
 */
export function canAccess(admin: AdminSession | null, key: PermissionKey, level: "view" | "manage" = "view"): boolean {
  if (!admin) return false;
  if (admin.role === "super") return true;
  const have = admin.permissions?.[key] ?? "none";
  return level === "view" ? have !== "none" : have === "manage";
}

/** `can(key, level)` for the signed-in admin (re-renders when the session changes). */
export function useCan() {
  const admin = useAuthStore((s) => s.admin);
  return (key: PermissionKey, level: "view" | "manage" = "view") => canAccess(admin, key, level);
}
