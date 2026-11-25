import "server-only";

/**
 * Egyptian phone helpers used by the Postgres entity mappers. Carved out of the partner
 * portal's `vendor/engine.ts` (`npm run check:shared` compares them).
 */

/**
 * Egyptian national number (no country code, no trunk 0): mobiles are 10 digits ("1XXXXXXXXX"),
 * Cairo/Alexandria landlines 9 ("2XXXXXXXX"), other landlines 8–9.
 */
export function nationalPhone(p: string): string {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length > 10) d = d.slice(2);
  return d.replace(/^0+/, "");
}

/** Display format: mobiles `+20 1XX XXX XXXX`, Cairo/Alex landlines `+20 2 XXXX XXXX`, others `+20 XX XXX XXXX`. */
export function prettyPhone(p: string): string {
  const d = nationalPhone(p);
  if (d.length === 10 && d.startsWith("1")) return `+20 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  if (d.length === 9 && (d.startsWith("2") || d.startsWith("3"))) return `+20 ${d[0]} ${d.slice(1, 5)} ${d.slice(5)}`;
  if (d.length >= 8) return `+20 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
  return d ? `+20 ${d}` : "";
}
