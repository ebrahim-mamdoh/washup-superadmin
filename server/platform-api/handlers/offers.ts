import "server-only";

import type { Offer, OfferListItem, OfferStatus } from "@/types/offers";
import { logAudit, nid, now } from "../db";
import { MockApiError, countBy, matchesSearch, ok, paginate, requireText, sortBy } from "../http";
import { findOrThrow } from "../lookups";
import { MAX_FIXED_DISCOUNT } from "../offer-rules";
import { route } from "../router";
import type { MockDatabase } from "../schema";
import { pushVendorNotification } from "../shared/notify";

const STATUSES: OfferStatus[] = ["draft", "scheduled", "active", "expired", "disabled"];

/** Status is derived from dates unless the offer is a draft or manually disabled. */
function deriveStatus(offer: Offer): OfferStatus {
  if (offer.status === "draft" || offer.status === "disabled") return offer.status;
  const t = now().getTime();
  if (new Date(offer.endAt).getTime() < t) return "expired";
  if (new Date(offer.startAt).getTime() > t) return "scheduled";
  return "active";
}

function parsePayload(body: Record<string, unknown>) {
  const title = (body.title ?? {}) as { ar?: string; en?: string };
  const description = (body.description ?? {}) as { ar?: string; en?: string };
  const titleAr = requireText(title.ar, "title.ar", "العنوان بالعربية");
  const titleEn = requireText(title.en, "title.en", "العنوان بالإنجليزية");
  const discountType = body.discountType === "fixed" ? "fixed" : "percent";
  const discountValue = Number(body.discountValue);
  if (Number.isNaN(discountValue) || discountValue <= 0) throw new MockApiError("قيمة الخصم غير صالحة", 422);
  if (discountType === "percent" && discountValue > 50) throw new MockApiError("الحد الأقصى للخصم ٥٠٪", 422);
  if (discountType === "fixed" && discountValue > MAX_FIXED_DISCOUNT) {
    throw new MockApiError(`الحد الأقصى للخصم الثابت ${MAX_FIXED_DISCOUNT}`, 422, { discountValue: ["قيمة الخصم الثابت كبيرة"] });
  }
  const startAt = new Date(String(body.startAt));
  const endAt = new Date(String(body.endAt));
  if (Number.isNaN(+startAt) || Number.isNaN(+endAt) || endAt <= startAt) {
    throw new MockApiError("تاريخ النهاية يجب أن يكون بعد تاريخ البداية", 422);
  }
  const branchIds = Array.isArray(body.branchIds) ? body.branchIds.map(String) : [];
  if (!branchIds.length) throw new MockApiError("اختر فرعًا واحدًا على الأقل", 422);
  return {
    title: { ar: titleAr, en: titleEn },
    description: { ar: String(description.ar ?? "").trim(), en: String(description.en ?? "").trim() },
    discountType: discountType as Offer["discountType"],
    discountValue,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    branchIds,
    serviceCategories: Array.isArray(body.serviceCategories) ? body.serviceCategories.map(String) : [],
  };
}

/** Offer targets must exist and a fixed discount stays below the cheapest targeted service (GAP-090). */
function validateTargets(db: MockDatabase, data: ReturnType<typeof parsePayload>) {
  if (data.branchIds.some((id) => !db.branches.some((b) => b.id === id))) throw new MockApiError("فرع غير موجود ضمن الفروع المختارة", 422);
  const prices = db.services
    .filter((s) => data.branchIds.includes(s.branchId) && s.active && s.type === "primary" && (!data.serviceCategories.length || data.serviceCategories.includes(s.category)))
    .map((s) => s.price);
  if (data.discountType === "fixed" && prices.length && data.discountValue >= Math.min(...prices)) {
    throw new MockApiError(`الخصم الثابت يجب أن يكون أقل من أرخص خدمة مشمولة (${Math.min(...prices)})`, 422);
  }
}

export const offerRoutes = [
  route("GET", "/admin/offers", ({ db, query }) => {
    const status = query.get("status");
    const scope = query.get("scope");
    const list: OfferListItem[] = db.offers.map((o) => ({
      ...o,
      status: deriveStatus(o),
      businessName: o.businessId ? db.businesses.find((b) => b.id === o.businessId)?.name ?? null : null,
      branchesCount: o.branchIds.length,
      redemptions: db.orders.filter((x) => x.offerId === o.id).length + (o.id === "of_platform" ? 64 : o.status === "active" ? 18 : 0),
    }));
    const base = list.filter((o) => (!scope || scope === "all" || o.scope === scope) && matchesSearch(query, o.title.ar, o.title.en));
    const counts = countBy(base, STATUSES, (o) => o.status);
    const filtered = status && status !== "all" ? base.filter((o) => o.status === status) : base;
    const sorted = sortBy(filtered, query, { startAt: (o) => o.startAt, endAt: (o) => o.endAt }, { key: "startAt", order: "desc" });
    const { items, pagination } = paginate(sorted, query, 12);
    return ok(items, "OK", { pagination, meta: { counts } });
  }),

  route("POST", "/admin/offers", ({ db, body, admin }) => {
    const data = parsePayload(body);
    validateTargets(db, data);
    const offer: Offer = { id: nid("of"), scope: "platform", businessId: null, featured: false, status: body.publish ? "active" : "draft", ...data };
    offer.status = deriveStatus(offer);
    db.offers.unshift(offer);
    logAudit(db, { actorId: admin.id, action: "create_offer", entity: "offers", entityId: offer.id, newValue: { title: offer.title.ar, status: offer.status }, reason: null });
    return ok(offer, offer.status === "draft" ? "تم حفظ العرض كمسودة" : "تم نشر العرض");
  }),

  route("PATCH", "/admin/offers/:id", ({ db, params, body, admin }) => {
    const offer = findOrThrow(db.offers, params.id, "العرض");
    if (offer.scope !== "platform") throw new MockApiError("عروض المغاسل تُدار من لوحة المغسلة", 403);
    const data = parsePayload(body);
    validateTargets(db, data);
    const before = { ...offer };
    Object.assign(offer, data);
    if (body.publish && offer.status === "draft") offer.status = "active";
    offer.status = deriveStatus(offer);
    logAudit(db, { actorId: admin.id, action: "update_offer", entity: "offers", entityId: offer.id, oldValue: { title: before.title.ar, discount: before.discountValue }, newValue: { title: offer.title.ar, discount: offer.discountValue } });
    return ok(offer, "تم تحديث العرض");
  }),

  route("POST", "/admin/offers/:id/status", ({ db, params, body, admin }) => {
    const offer = findOrThrow(db.offers, params.id, "العرض");
    const enable = Boolean(body.enabled);
    // Scope rule (GAP-090): wash offers can be switched off/on here as moderation (edited only in the
    // wash portal); switching off needs a reason and the wash is told.
    const reason = enable ? (typeof body.reason === "string" ? body.reason.trim() : "") : requireText(body.reason, "reason", "سبب الإيقاف", 5);
    const old = deriveStatus(offer);
    offer.status = enable ? "active" : "disabled";
    offer.status = deriveStatus(offer);
    logAudit(db, { actorId: admin.id, action: enable ? "enable_offer" : "disable_offer", entity: "offers", entityId: offer.id, oldValue: old, newValue: offer.status, reason: reason || null });
    if (offer.scope !== "platform" && offer.businessId) {
      pushVendorNotification(db, offer.businessId, null, "platform", enable ? "أعادت Wash Up تفعيل عرضك" : "أوقفت Wash Up عرضك", enable ? `العرض «${offer.title.ar}» مفعل مجددًا.` : `العرض «${offer.title.ar}» موقوف — السبب: ${reason}`, "/offers");
    }
    return ok(offer, enable ? "تم تفعيل العرض" : "تم إيقاف العرض");
  }),
];
