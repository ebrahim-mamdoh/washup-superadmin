import "server-only";

import type { Payout } from "@/types/finance";

import { round2 } from "./db";
import { MockApiError } from "./http";

/**
 * The payment being recorded (GAP-092): `amount` is what is paid NOW and is added to the stored
 * total; `expectedPaid` (the total the admin saw) must still be current, so a stale tab can't
 * double-pay. Older clients sending a running total (`amountPaid`) are accepted only when it does
 * not go below what is already paid.
 */
export function payoutIncrement(current: Pick<Payout, "amountDue" | "amountPaid">, body: Record<string, unknown>) {
  const paid = Number(current.amountPaid) || 0;
  let amount: number;
  if (body.amount !== undefined) {
    amount = Number(body.amount);
    if (body.expectedPaid !== undefined && round2(Number(body.expectedPaid)) !== round2(paid)) {
      throw new MockApiError("سُجّلت دفعة على هذه المستحقات من شاشة أخرى — حدّث الصفحة وراجع المتبقي", 409);
    }
  } else {
    const legacyTotal = Number(body.amountPaid);
    if (!Number.isNaN(legacyTotal) && legacyTotal < paid) throw new MockApiError("لا يمكن تقليل المبلغ المدفوع", 422);
    amount = legacyTotal - paid;
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new MockApiError("أدخل مبلغًا صحيحًا", 422);
  const total = round2(paid + amount);
  if (total > round2(Number(current.amountDue))) throw new MockApiError("المبلغ أكبر من المتبقي المستحق", 422);
  return { amount: round2(amount), total };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Validated period of `POST /admin/finance/payouts/generate` (GAP-020): ISO dates, end ≥ start, ≤ 1 year. */
export function settlementPeriod(body: Record<string, unknown>): { start: string; end: string; reason: string } {
  const start = String(body.periodStart ?? "").slice(0, 10);
  const end = String(body.periodEnd ?? "").slice(0, 10);
  if (!DAY.test(start) || !DAY.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    throw new MockApiError("حدد بداية ونهاية الفترة", 422, { periodStart: ["تاريخ غير صالح"] });
  }
  if (end < start) throw new MockApiError("نهاية الفترة يجب أن تكون بعد بدايتها", 422, { periodEnd: ["قبل البداية"] });
  if (Date.parse(end) - Date.parse(start) > 366 * 86_400_000) throw new MockApiError("الفترة لا تتجاوز سنة", 422);
  const reason = String(body.reason ?? "").trim();
  if (reason.length < 5) throw new MockApiError("اكتب سبب إنشاء التسويات (5 أحرف على الأقل)", 422, { reason: ["السبب مطلوب"] });
  return { start, end, reason };
}
