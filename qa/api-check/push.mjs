// Browser push server path on Supabase: device registration, delivery after a panel action, cleanup of
// tokens FCM rejects, and the database hook's secret check. Uses a fake device token (FCM answers
// INVALID_ARGUMENT, so the token must be removed) — a real browser test needs the Firebase web app config.
// Usage: node qa/api-check/push.mjs <adminBase> <vendorBase> <webhookSecret>
// Writes: two fake push_devices rows (removed by the run), a review report then "keep" (closed).
const [adminBase, vendorBase, secret] = process.argv.slice(2);
const out = [];
const log = (ok, name, detail = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
async function call(base, method, path, token, body, headers = {}) {
  const res = await fetch(`${base}/api/v1${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, msg: json?.message };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = (await call(adminBase, "POST", "/admin/auth/login", null, { email: "sara@carzen.demo", password: "demo1234" })).json.data.access_token;
const owner = (await call(vendorBase, "POST", "/vendor/auth/login", null, { phone: "01200000000", password: "demo1234" })).json.data.access_token;
const fakeVendor = `qa-fake-web-token-vendor-${Date.now()}`;
const fakeAdmin = `qa-fake-web-token-admin-${Date.now()}`;

const rv = await call(vendorBase, "POST", "/vendor/push/register", owner, { token: fakeVendor, appVersion: "qa" });
log(rv.status === 200, "vendor registers a browser", rv.msg);
const ra = await call(adminBase, "POST", "/admin/push/register", admin, { token: fakeAdmin, appVersion: "qa" });
log(ra.status === 200, "admin registers a browser", ra.msg);
log((await call(vendorBase, "POST", "/vendor/push/register", owner, { token: "x" })).status === 422, "too-short token → 422");
log((await call(vendorBase, "POST", "/vendor/push/register", null, { token: fakeVendor })).status === 401, "register without session → 401");

// A vendor report creates an admin notification; the admin "keep" creates a vendor notification.
const review = (await call(vendorBase, "GET", "/vendor/reviews?branchId=all", owner)).json.data.find((r) => !r.reportedByWash && r.status === "visible");
const rep = await call(vendorBase, "POST", `/vendor/reviews/${review.id}/report`, owner, { reason: "اختبار إشعارات المتصفح" });
log(rep.status === 200, "vendor report → admin notification", rep.msg);
const keep = await call(adminBase, "POST", `/admin/reviews/${review.id}/visibility`, admin, { hidden: false, reason: "اختبار إشعارات المتصفح — إبقاء" });
log(keep.status === 200, "admin keep → vendor notification", keep.msg);

// after() runs once the responses are sent: FCM rejects the fake tokens and they are deleted.
await sleep(4000);
const again = await call(vendorBase, "POST", "/vendor/push/unregister", owner, { token: fakeVendor });
log(again.status === 200, "unregister answers 200", again.msg);

// Database hook: secret enforced, delivery result returned.
const notes = (await call(vendorBase, "GET", "/vendor/notifications", owner)).json.data;
const bad = await call(vendorBase, "POST", "/vendor/push/hook", null, { id: notes[0].id }, { "x-webhook-secret": "wrong" });
log(bad.status === 401, "hook with a wrong secret → 401", String(bad.status));
const none = await call(vendorBase, "POST", "/vendor/push/hook", null, { id: notes[0].id });
log(none.status === 401, "hook without a secret → 401", String(none.status));
if (secret) {
  const good = await call(vendorBase, "POST", "/vendor/push/hook", null, { id: notes[0].id }, { "x-webhook-secret": secret });
  log(good.status === 200, "hook with the secret delivers", JSON.stringify(good.json?.data));
  const ah = await call(adminBase, "POST", "/admin/push/hook", null, { id: "an_does_not_exist" }, { "x-webhook-secret": secret });
  log(ah.status === 200 && ah.json?.data === null, "admin hook for an unknown id → nothing sent", JSON.stringify(ah.json?.data));
}

console.log(out.join("\n"));
console.log(`\n${out.filter((l) => l.startsWith("PASS")).length}/${out.length} passed`);
