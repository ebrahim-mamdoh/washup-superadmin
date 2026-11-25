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
