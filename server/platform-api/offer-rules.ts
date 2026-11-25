import "server-only";

/**
 * Upper bound of a fixed-amount platform offer (GAP-090), in the wash's currency. Postgres also
 * keeps it below the cheapest targeted service; the editor shows the same cap.
 */
export const MAX_FIXED_DISCOUNT = 1000;
