import "server-only";

import { MockApiError } from "./http";

/** The review checklist the approve endpoint requires (same keys as the panel's REVIEW_CHECKLIST). */
export const REVIEW_CHECKLIST_KEYS = [
  "owner_verified",
  "location_verified",
  "prices_reasonable",
  "hours_clear",
  "capacity_ok",
  "documents_complete",
] as const;

/** Every checklist key must be ticked; unknown or duplicate strings don't count (GAP-087). */
export function assertChecklist(raw: unknown): void {
  const given = new Set(Array.isArray(raw) ? raw.map(String) : []);
  const missing = REVIEW_CHECKLIST_KEYS.filter((k) => !given.has(k));
  if (missing.length) throw new MockApiError("أكمل قائمة التحقق قبل الموافقة", 422, { checklist: missing.map((k) => `missing:${k}`) });
}
