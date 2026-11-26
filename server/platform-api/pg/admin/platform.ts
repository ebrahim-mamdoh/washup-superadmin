import "server-only";

import type { AuditLogListItem } from "@/types/audit";
import type { AdminNotification } from "@/types/notifications";
import type { SearchResult } from "@/types/search";
import type { CatalogArea, PlatformSettings, SettingsSection } from "@/types/settings";
import postgres from "postgres";

import { MockApiError, ok, requireText } from "../../http";
import { ADMIN_NOTIFICATION_COLS, BUSINESS_FROM, PHONE, adminNotificationsWhere } from "../entities";
import { paged, searchPattern } from "../list";
import { SEARCH_GROUP_MODULE, hasLevel, visibleNotificationTypes } from "../../permissions";
import { logAudit } from "../platform";
import { route } from "../router";
import { type Q, db, tx } from "../sql";

const SECTIONS: SettingsSection[] = ["general", "bookingDefaults", "legal", "catalogs"];

/** Settings sections stored in `platform_settings` (catalogs live in their own tables). */
const SETTING_KEYS = { general: "general", bookingDefaults: "booking_defaults", legal: "legal" } as const;
type JsonSection = keyof typeof SETTING_KEYS;

const CATALOG_TABLES = { areas: "areas", serviceCategories: "service_categories", amenities: "amenities" } as const;
type CatalogKey = keyof typeof CATALOG_TABLES;

/**
 * jsonb does not keep key order; restore the mock's (seed) order so responses and
 * audit snapshots read the same. Unknown keys keep their place after known ones.
 */
const KEY_ORDER: Record<string, string[]> = {
  general: ["platformName", "currency", "supportPhone", "supportEmail", "supportHours"],
  bookingDefaults: ["autoConfirm", "slotIntervalMin", "leadTimeMin", "maxAdvanceDays", "freeCancelMin", "noShowGraceMin", "reminderMin"],
  legal: ["terms", "privacy"],
  notificationTemplate: ["id", "event", "audience", "title", "body"],
};
const LOCALIZED_ORDER = ["ar", "en"];

function ordered(value: unknown, keys: string[] | null): unknown {
  if (Array.isArray(value)) return value.map((v) => ordered(v, keys));
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const isLocalized = "ar" in obj && "en" in obj;
  const order = isLocalized ? LOCALIZED_ORDER : (keys ?? []);
  const names = [...order.filter((k) => k in obj), ...Object.keys(obj).filter((k) => !order.includes(k))];
  return Object.fromEntries(names.map((k) => [k, ordered(obj[k], null)]));
}

async function catalog(q: Q, key: CatalogKey): Promise<CatalogArea[]> {
  return q<CatalogArea[]>`select id, name, active from ${q("public." + CATALOG_TABLES[key])} order by sort_order, id`;
}

async function loadSettings(q: Q): Promise<PlatformSettings> {
  const [rows, areas, serviceCategories, amenities] = await Promise.all([
    q<{ key: string; value: unknown }[]>`
      select key, value from public.platform_settings where key in ('general', 'booking_defaults', 'legal', 'notification_templates')`,
    catalog(q, "areas"),
    catalog(q, "serviceCategories"),
    catalog(q, "amenities"),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const WASHUP_GENERAL = {
    platformName: "Wash Up",
    currency: "EGP",
    supportPhone: "+20 150 000 1111",
    supportEmail: "support@washup.app",
    supportHours: { ar: "يومياً ٩:٠٠ ص – ٩:٠٠ م", en: "Daily 9:00 AM – 9:00 PM" },
  };
  const rawGeneral = { ...WASHUP_GENERAL, ...((byKey.get("general") as Record<string, unknown>) ?? {}) };
  if (!rawGeneral.platformName || rawGeneral.platformName === "Carzen") rawGeneral.platformName = "Wash Up";
  if (!rawGeneral.supportEmail || String(rawGeneral.supportEmail).includes("carzen.demo")) rawGeneral.supportEmail = "support@washup.app";
  return {
    general: ordered(rawGeneral, KEY_ORDER.general) as PlatformSettings["general"],
    bookingDefaults: ordered(byKey.get("booking_defaults") ?? {}, KEY_ORDER.bookingDefaults) as PlatformSettings["bookingDefaults"],
    legal: ordered(byKey.get("legal") ?? {}, KEY_ORDER.legal) as PlatformSettings["legal"],
    catalogs: { areas, serviceCategories, amenities },
    notificationTemplates: ordered(byKey.get("notification_templates") ?? [], KEY_ORDER.notificationTemplate) as PlatformSettings["notificationTemplates"],
  };
}

/**
 * Upserts one catalog from the submitted list (order = sort_order). Nothing is deleted (GAP-088): a
 * stale tab must not drop items someone else added; switching an item off is the way to retire it.
 */
async function saveCatalog(t: Q, key: Exclude<CatalogKey, "areas">, items: unknown) {
  const list = (Array.isArray(items) ? items : []).map((raw, i) => {
    const item = (raw ?? {}) as { id?: unknown; name?: { ar?: unknown; en?: unknown }; active?: unknown };
    return {
      id: String(item.id ?? "").trim(),
      name: { ar: String(item.name?.ar ?? "").trim(), en: String(item.name?.en ?? "").trim() },
      active: item.active !== false,
      sort: i,
    };
  });
  if (list.some((i) => !i.id)) throw new MockApiError("معرّف العنصر مطلوب في القوائم", 422);
  const table = t("public." + CATALOG_TABLES[key]);
  if (list.length) {
    await t`
      insert into ${table} (id, name, active, sort_order)
      select c.id, c.name, c.active, c.sort from jsonb_to_recordset(${t.json(list)}::jsonb) as c(id text, name jsonb, active boolean, sort smallint)
      on conflict (id) do update set name = excluded.name, active = excluded.active, sort_order = excluded.sort_order`;
  }
}

const RECEIPTS_KEY = "__WASHUP_ADMIN_NOTIFICATION_READS__";
type GlobalWithReceipts = typeof globalThis & { [RECEIPTS_KEY]?: { exists: boolean; checkedAt: number } };

/**
 * Whether the per-admin read receipts table exists (GAP-095; created by a migration the lead applies).
 * Cached: "exists" for good, "missing" re-checked every minute so applying it needs no redeploy.
 */
async function hasReadReceipts(q: Q): Promise<boolean> {
  const g = globalThis as GlobalWithReceipts;
  const hit = g[RECEIPTS_KEY];
  if (hit && (hit.exists || Date.now() - hit.checkedAt < 60_000)) return hit.exists;
  const [{ present: exists }] = await q<{ present: boolean }[]>`select to_regclass('public.admin_notification_reads') is not null as present`;
  g[RECEIPTS_KEY] = { exists, checkedAt: Date.now() };
  return exists;
}

/** "Read by this admin" (receipts) or the legacy shared flag. */
function readExpr(q: Q, receipts: boolean, adminId: string) {
  return receipts
    ? q`exists (select 1 from public.admin_notification_reads r where r.notification_id = an.id and r.admin_id = ${adminId})`
    : q`an.read`;
}

/** Audit list columns (alias al). Actor name follows the mock: admin, then staff, "النظام" for the seed, else the id. */
const AUDIT_LIST_COLS = `al.id, al.actor_type as "actorType", al.actor_id as "actorId", al.action, al.entity, al.entity_id as "entityId",
  al.branch_id as "branchId", al.old_value as "oldValue", al.new_value as "newValue", al.reason, al.at,
  case when al.actor_id = 'seed' then 'النظام'
       else coalesce((select a.name from public.admin_users a where a.id = al.actor_id),
                     (select s.name from public.staff s where s.id = al.actor_id), al.actor_id) end as "actorName"`;

export const platformRoutes = [
  // ── Settings ──────────────────────────────────────────────
  route("GET", "/admin/settings", async () => ok(await loadSettings(db()))),

  route("PUT", "/admin/settings/:section", async ({ params, body, admin }) => {
    const section = params.section as SettingsSection;
    if (!SECTIONS.includes(section)) throw new MockApiError("قسم غير معروف", 404);
    const reason = requireText(body.reason, "reason", "سبب التعديل", 5);
    if (!body.value || typeof body.value !== "object") throw new MockApiError("القيمة مطلوبة", 422);

    if (section === "bookingDefaults") {
      const v = body.value as Record<string, unknown>;
      for (const key of ["slotIntervalMin", "leadTimeMin", "maxAdvanceDays", "freeCancelMin", "noShowGraceMin", "reminderMin"]) {
        const n = Number(v[key]);
        if (Number.isNaN(n) || n < 0 || n > 10080) throw new MockApiError("قيمة غير صالحة في إعدادات الحجز", 422, { [key]: ["قيمة غير صالحة"] });
      }
    }

    try {
      const settings = await tx(async (t) => {
        const old = (await loadSettings(t))[section];
        if (section === "catalogs") {
          const v = body.value as Record<string, unknown>;
          // Areas are edited only on /admin/areas with a country and a map pin (GAP-088): ignored here.
          for (const key of ["serviceCategories", "amenities"] as const) {
            if (v[key] !== undefined) await saveCatalog(t, key, v[key]);
          }
        } else {
          // Section shapes are validated by the typed client form; stay as permissive as the mock.
          await t`
            insert into public.platform_settings (key, value, updated_by)
            values (${SETTING_KEYS[section as JsonSection]}, ${t.json(body.value as postgres.JSONValue)}, ${admin.id})
            on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by`;
        }
        await logAudit(t, {
          actorId: admin.id,
          action: "update_settings",
          entity: "settings",
          entityId: section,
          oldValue: old,
          newValue: body.value,
          reason,
        });
        return loadSettings(t);
      });
      return ok(settings, "تم حفظ الإعدادات");
    } catch (error) {
      // A catalog item still used by branches/services/offers cannot be deleted.
      if (error instanceof postgres.PostgresError && error.code === "23503") {
        throw new MockApiError("لا يمكن حذف عنصر مستخدم في الفروع أو الخدمات — عطّله بدلًا من حذفه", 409);
      }
      throw error;
    }
  }),

  // ── Audit log (read-only by design) ───────────────────────
  route("GET", "/admin/audit", async ({ query }) => {
    const sql = db();
    const actorId = query.get("actorId");
    const action = query.get("action");
    const entity = query.get("entity");
    const actorType = query.get("actorType");
    const search = searchPattern(query);

    const base = sql`select ${sql.unsafe(AUDIT_LIST_COLS)} from public.audit_logs al`;
    const where = sql`
      where true
        ${actorId && actorId !== "all" ? sql`and w."actorId" = ${actorId}` : sql``}
        ${action && action !== "all" ? sql`and w.action = ${action}` : sql``}
        ${entity && entity !== "all" ? sql`and w.entity = ${entity}` : sql``}
        ${actorType && actorType !== "all" ? sql`and w."actorType"::text = ${actorType}` : sql``}
        ${search ? sql`and (w."entityId" ilike ${search} or w.reason ilike ${search} or w."actorName" ilike ${search} or w.action ilike ${search})` : sql``}`;

    const [[{ total }], [meta]] = await Promise.all([
      sql<{ total: number }[]>`with w as (${base}) select count(*)::int as total from w ${where}`,
      sql<{ actions: string[]; entities: string[]; actors: { id: string; name: string }[] }[]>`
        select coalesce((select json_agg(x.action order by x.action collate "C") from (select distinct action from public.audit_logs) x), '[]') as actions,
               coalesce((select json_agg(x.entity order by x.entity collate "C") from (select distinct entity from public.audit_logs) x), '[]') as entities,
               coalesce((select json_agg(json_build_object('id', a.id, 'name', a.name) order by a.created_at, a.id) from public.admin_users a), '[]') as actors`,
    ]);
    const { items, pagination } = await paged(query, total, 20, (limit, offset) =>
      sql<AuditLogListItem[]>`with w as (${base}) select * from w ${where} order by w.at desc, w.id limit ${limit} offset ${offset}`,
    );
    return ok(items, "OK", { pagination, meta });
  }),

  // ── Notifications ─────────────────────────────────────────
  // Each admin sees only the types of modules they can open (GAP-012). Read state is per admin once
  // `admin_notification_reads` exists (GAP-095; live since 2026-11-26, in the schema baseline of the customer-app repo); until then
  // it falls back to the shared `read` column.
  route("GET", "/admin/notifications", async ({ query, admin }) => {
    const sql = db();
    const filter = query.get("filter");
    const receipts = await hasReadReceipts(sql);
    const isRead = readExpr(sql, receipts, admin.id);
    const visible = sql`an.type::text = any(${visibleNotificationTypes(admin.permissions)}::text[])`;
    const cond =
      filter === "unread"
        ? sql`${visible} and not ${isRead}`
        : filter && filter !== "all"
          ? sql`${visible} and an.type::text = ${filter}`
          : visible;
    const [[{ total }], [{ unread }]] = await Promise.all([
      sql<{ total: number }[]>`select count(*)::int as total from public.admin_notifications an where ${cond}`,
      sql<{ unread: number }[]>`select count(*)::int as unread from public.admin_notifications an where ${visible} and not ${isRead}`,
    ]);
    const { items, pagination } = await paged(query, total, 20, (limit, offset) =>
      sql<AdminNotification[]>`
        select an.id, an.type, an.title, an.body, an.href, ${isRead} as read, an.created_at as "createdAt"
        from public.admin_notifications an where ${cond}
        order by an.created_at desc, an.id limit ${limit} offset ${offset}`,
    );
    return ok(items, "OK", { pagination, meta: { unread } });
  }),

  route("POST", "/admin/notifications/:id/read", async ({ params, admin }) => {
    const sql = db();
    const visible = visibleNotificationTypes(admin.permissions);
    const [found] = await adminNotificationsWhere(sql, sql`an.id = ${params.id} and an.type::text = any(${visible}::text[])`);
    if (!found) throw new MockApiError("الإشعار غير موجود", 404);
    if (await hasReadReceipts(sql)) {
      await sql`insert into public.admin_notification_reads (notification_id, admin_id) values (${found.id}, ${admin.id}) on conflict do nothing`;
      return ok({ ...found, read: true });
    }
    const [n] = await sql<AdminNotification[]>`
      update public.admin_notifications an set read = true where an.id = ${found.id}
      returning ${sql.unsafe(ADMIN_NOTIFICATION_COLS)}`;
    return ok(n);
  }),

  route("POST", "/admin/notifications/read-all", async ({ admin }) => {
    const sql = db();
    const visible = visibleNotificationTypes(admin.permissions);
    if (await hasReadReceipts(sql)) {
      await sql`
        insert into public.admin_notification_reads (notification_id, admin_id)
        select an.id, ${admin.id} from public.admin_notifications an where an.type::text = any(${visible}::text[])
        on conflict do nothing`;
    } else {
      await sql`update public.admin_notifications set read = true where not read and type::text = any(${visible}::text[])`;
    }
    return ok(null, "تم تعليم كل الإشعارات كمقروءة");
  }),

  // ── Global search (⌘K) ────────────────────────────────────
  route("GET", "/admin/search", async ({ query, admin }) => {
    const sql = db();
    const q = query.get("q")?.trim() ?? "";
    if (q.length < 2) return ok({ query: q, results: [] });
    const like = searchPattern(new URLSearchParams({ search: q }))!;
    const rawPlate = q;

    // Top 5 per group. The mock keeps seed insertion order, which the database does not store:
    // people and washes come oldest first (= seed order), orders exact match first, then by number.
    const [customers, plates, washes, branches, orders, complaints] = await Promise.all([
      sql<SearchResult[]>`
        select cu.id, 'customers' as "group", cu.name as title, ${sql.unsafe(PHONE("cu.phone"))} as subtitle, '/customers/' || cu.id as href
        from public.customers cu
        where cu.name ilike ${like} or ${sql.unsafe(PHONE("cu.phone"))} ilike ${like} or cu.phone ilike ${like}
        order by cu.created_at, cu.id limit 5`,
      sql<SearchResult[]>`
        select v.id, 'plates' as "group", v.plate as title, v.make || ' ' || v.model || ' — ' || coalesce(cu.name, '') as subtitle,
               '/customers/' || v.customer_id as href
        from public.vehicles v left join public.customers cu on cu.id = v.customer_id
        where length(public.normalize_plate(${rawPlate})) >= 2 and strpos(v.plate_normalized, public.normalize_plate(${rawPlate})) > 0
        order by cu.created_at, v.id limit 5`,
      sql<SearchResult[]>`
        select b.id, 'washes' as "group", b.name ->> 'ar' as title, coalesce(ow.name, '') as subtitle, '/washes/' || b.id as href
        from ${sql.unsafe(BUSINESS_FROM)}
        where b.name ->> 'ar' ilike ${like} or b.name ->> 'en' ilike ${like} or ow.name ilike ${like}
        order by b.created_at, b.id limit 5`,
      sql<SearchResult[]>`
        select br.id, 'branches' as "group", br.name ->> 'ar' as title, coalesce(bz.name ->> 'ar', '—') as subtitle,
               '/washes/' || br.business_id as href
        from public.branches br left join public.businesses bz on bz.id = br.business_id
        where br.name ->> 'ar' ilike ${like} or br.name ->> 'en' ilike ${like}
        order by bz.created_at, br.created_at, br.id limit 5`,
      sql<SearchResult[]>`
        select o.id, 'orders' as "group", o.number as title,
               coalesce(bz.name ->> 'ar', '—') || ' — ' || coalesce(cu.name, 'عميل مباشر') as subtitle, '/orders/' || o.id as href
        from public.orders o
        left join public.businesses bz on bz.id = o.business_id
        left join public.customers cu on cu.id = o.customer_id
        where o.number ilike ${like} or o.code ilike ${like}
        order by (lower(o.number) = lower(${q}) or lower(o.code) = lower(${q})) desc, o.number, o.id limit 5`,
      sql<SearchResult[]>`
        select c.id, 'complaints' as "group", c.ticket as title, coalesce(cu.name, '') as subtitle, '/complaints/' || c.id as href
        from public.complaints c left join public.customers cu on cu.id = c.customer_id
        where c.ticket ilike ${like}
        order by c.created_at desc, c.id limit 5`,
    ]);
    // Only groups of modules the caller may open (GAP-012).
    const results = [...customers, ...plates, ...washes, ...branches, ...orders, ...complaints];
    return ok({ query: q, results: results.filter((r) => hasLevel(admin.permissions, SEARCH_GROUP_MODULE[r.group], "view")) });
  }),

  // ── Demo utilities ────────────────────────────────────────
  // Never wipes a real database: on Supabase, re-seed the project with the CLI instead.
  route("POST", "/admin/system/reset", async () => {
    throw new MockApiError(
      "إعادة ضبط بيانات العرض متاحة فقط على مصدر البيانات التجريبي (mock). على Supabase أعد تهيئة المشروع من سطر الأوامر (npm run db:push:seed).",
      403,
    );
  }),
];
