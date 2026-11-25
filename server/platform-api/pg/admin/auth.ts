import "server-only";

import type { PermissionKey, PermissionLevel } from "@/types/admins";
import type { AdminSession, AdminUser } from "@/types/auth";

import { MockApiError, ok } from "../../http";
import { type Identity, refreshSession, sessionTokens, signInWithPassword, signOut } from "../auth";
import { adminsWhere } from "../entities";
import { logAudit } from "../platform";
import { permissionsFor } from "../../permissions";
import { route } from "../router";
import { type Q, db } from "../sql";

/** Adds the role's row of the stored roles matrix (`admin_role_permissions`); super is fixed (full access). */
async function withPermissions(q: Q, admin: AdminUser): Promise<AdminSession> {
  if (admin.role === "super") return { ...admin, permissions: permissionsFor("super", null), demoData: false };
  const rows = await q<{ key: PermissionKey; level: PermissionLevel }[]>`
    select permission_key as key, level from public.admin_role_permissions where role = ${admin.role}`;
  const row = Object.fromEntries(rows.map((r) => [r.key, r.level])) as Record<PermissionKey, PermissionLevel>;
  return { ...admin, permissions: permissionsFor(admin.role, { [admin.role]: row }), demoData: false };
}

/**
 * Signed-in identity → active admin profile with its permissions, or null. Checked on every
 * request; the dispatcher then requires the module level each route is mapped to
 * (`../../permissions.ts`, GAP-012). Inactive admins are refused everywhere.
 */
export async function resolveAdmin(q: Q, identity: Identity): Promise<AdminSession | null> {
  const [admin] =
    identity.kind === "supabase"
      ? await adminsWhere(q, q`a.user_id = ${identity.userId}`)
      : await adminsWhere(q, q`a.id = ${identity.profileId}`);
  return admin && admin.status === "active" ? withPermissions(q, admin) : null;
}

export const authRoutes = [
  route(
    "POST",
    "/admin/auth/login",
    async ({ body }) => {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!email || !password) {
        throw new MockApiError("البريد الإلكتروني وكلمة المرور مطلوبان", 422);
      }

      const sql = db();
      const [profile] = await adminsWhere(sql, sql`lower(a.email) = ${email}`);
      const session = await signInWithPassword({ email }, password, profile?.id ?? null);
      if (!session) throw new MockApiError("البريد الإلكتروني أو كلمة المرور غير صحيحة", 401);

      const [admin] =
        session.identity.kind === "supabase"
          ? await adminsWhere(sql, sql`a.user_id = ${session.identity.userId}`)
          : await adminsWhere(sql, sql`a.id = ${session.identity.profileId}`);
      if (!admin) throw new MockApiError("هذا الحساب غير مرتبط بملف إداري في Wash Up", 403);
      if (admin.status !== "active") {
        throw new MockApiError("هذا الحساب موقوف. تواصل مع مدير النظام.", 403);
      }
      const [updated] = await sql<{ lastLoginAt: string }[]>`
        update public.admin_users set last_login_at = now() where id = ${admin.id} returning last_login_at as "lastLoginAt"`;
      await logAudit(sql, { actorId: admin.id, action: "admin.login", entity: "admins", entityId: admin.id });

      const withPerms = await withPermissions(sql, { ...admin, lastLoginAt: updated.lastLoginAt });
      return ok({ ...sessionTokens(session), admin: withPerms }, "تم تسجيل الدخول بنجاح");
    },
    true,
  ),

  // Renews an expiring session; the profile is re-checked (a deactivated admin can't refresh).
  route(
    "POST",
    "/admin/auth/refresh",
    async ({ body }) => {
      const session = await refreshSession(String(body.refresh_token ?? ""));
      const admin = session ? await resolveAdmin(db(), session.identity) : null;
      if (!session || !admin) throw new MockApiError("انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى", 401);
      return ok(sessionTokens(session));
    },
    true,
  ),

  route("GET", "/admin/auth/me", async ({ admin }) => ok(admin)),

  route("POST", "/admin/auth/logout", async ({ token }) => {
    if (token) await signOut(token);
    return ok(null, "تم تسجيل الخروج");
  }),
];
