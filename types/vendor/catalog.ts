/*
 * Partner-portal record types the admin API still stores or writes (mock store shape,
 * wash inbox). The rest of the vendor contract lives in the partner portal repo; these
 * declarations must match its `types/vendor/*` (`npm run check:shared`).
 */

export type VendorNotificationType =
  | "new_booking"
  | "booking_cancelled"
  | "cash_difference"
  | "high_cancellation"
  | "branch_issue"
  | "daily_summary"
  | "review"
  | "platform"
  | "payout";
