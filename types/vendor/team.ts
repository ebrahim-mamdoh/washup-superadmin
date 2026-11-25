import type { PaymentMethod } from "../orders";

/* Partner-portal record types kept in the mock store (see `./catalog.ts`). */

export type ShiftClosingStatus = "open" | "submitted" | "reviewed" | "flagged";

export type MethodTotals = Record<PaymentMethod, number> & { total: number };

export interface DayClosing {
  id: string;
  branchId: string;
  date: string;
  expected: MethodTotals;
  actual: MethodTotals;
  difference: number;
  reason: string | null;
  ordersLocked: number;
  closedBy: string;
  closedByName: string;
  closedAt: string;
}
