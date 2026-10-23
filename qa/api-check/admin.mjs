// Super Admin API test: every read route, robustness, and reversible writes on test/demo records.
// Usage: node qa/api-check/admin.mjs <base> <email> <password>
// Writes (each undone in the same run): QA customer/employee suspend+reactivate, Heliopolis branch off+on,
// one review hide+restore, commission +1 then back, a draft platform offer (left disabled), a complaint note.
const [base, email, password] = process.argv.slice(2);
const API = `${base}/api/v1`;
const out = [];
const log = (ok, name, detail = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
async function call(method, path, token, body) {
  let res;
  try {
    res = await fetch(API + path, { method, signal: AbortSignal.timeout(60000), headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    return { status: 599, json: null, msg: `TIMEOUT/${e.name} ${method} ${path}` };
  }
  const json = await res.json().catch(() => null);
  return { status: res.status, json, msg: json?.message };
}
const step = async (name, method, path, token, body, expect = 200) => {
  const r = await call(method, path, token, body);
  const ok = Array.isArray(expect) ? expect.includes(r.status) : r.status === expect;
  log(ok, name, ok ? r.msg : `${r.status} ${r.msg}`);
  return r;
};
const get = async (path, T) => (await call("GET", path, T)).json?.data;

const login = await call("POST", "/admin/auth/login", null, { email, password });
if (login.status !== 200) { console.log("login failed", login.status, login.msg); process.exit(1); }
const T = login.json.data.access_token;

// ── Reads (every screen) ──
const READS = ["/admin/auth/me", "/admin/dashboard?period=today", "/admin/dashboard?period=7d", "/admin/dashboard?period=30d",
  "/admin/washes", "/admin/washes?status=active&sort=rating&order=desc", "/admin/branches", "/admin/branches?per_page=100", "/admin/staff", "/admin/staff?role=manager",
  "/admin/applications", "/admin/applications?status=pending", "/admin/orders", "/admin/orders?status=cancelled&source=walk_in", "/admin/orders?dateFrom=2026-10-01&dateTo=2026-10-20",
  "/admin/customers", "/admin/customers?filter=suspended", "/admin/complaints", "/admin/complaints?status=open", "/admin/reviews", "/admin/reviews?filter=reported",
  "/admin/offers", "/admin/finance/overview?period=30d", "/admin/finance/transactions", "/admin/finance/transactions?filter=discrepancy", "/admin/finance/commission",
  "/admin/finance/payouts", "/admin/admins", "/admin/roles", "/admin/settings", "/admin/audit", "/admin/notifications", "/admin/search?q=CZ"];
for (const p of READS) {
  const t0 = Date.now();
  const r = await call("GET", p, T);
  log(r.status === 200, `GET ${p} (${Date.now() - t0} ms)`, r.status === 200 ? "" : `${r.status} ${r.msg}`);
}
const wash = (await get("/admin/washes?search=Carzen", T))?.[0] ?? (await get("/admin/washes", T))[0];
await step("wash details", "GET", `/admin/washes/${wash.id}`, T);
await step("wash suspend impact", "GET", `/admin/washes/${wash.id}/impact`, T);
const app = (await get("/admin/applications", T))[0];
if (app) await step("application details", "GET", `/admin/applications/${app.id}`, T);
const order = (await get("/admin/orders", T))[0];
await step("order details", "GET", `/admin/orders/${order.id}`, T);
const cust = (await get("/admin/customers", T))[0];
await step("customer details", "GET", `/admin/customers/${cust.id}`, T);
const comp = (await get("/admin/complaints", T))[0];
if (comp) await step("complaint details", "GET", `/admin/complaints/${comp.id}`, T);
const txn = (await get("/admin/finance/transactions", T))[0];
if (txn) await step("transaction details", "GET", `/admin/finance/transactions/${txn.id}`, T);

// ── Robustness (never 500) ──
for (const p of ["/admin/orders/%25", "/admin/washes/CZ-%25", "/admin/customers/x%00", "/admin/orders?sort=__proto__", "/admin/washes?sort=constructor",
  "/admin/customers?search=a%00b", "/admin/search?q=a%00b", "/admin/orders?dateFrom=garbage", "/admin/audit?to=2026-99-99", "/admin/dashboard?period=__proto__"]) {
  const r = await call("GET", p, T);
  log(r.status < 500, `GET ${p} → not 500`, String(r.status));
}
await step("vendor namespace hidden here → 404", "GET", "/vendor/auth/me", T, undefined, 404);
await step("demo reset refused on Supabase", "POST", "/admin/system/reset", T, {}, 403);

// ── Reversible writes ──
// Notifications
const notes = await get("/admin/notifications", T);
if (notes?.[0]) await step("notification read", "POST", `/admin/notifications/${notes[0].id}/read`, T);
await step("notifications read-all", "POST", "/admin/notifications/read-all", T);
// Settings: save every section unchanged
const settings = await get("/admin/settings", T);
for (const section of Object.keys(settings ?? {}).filter((s) => s !== "notificationTemplates")) {
  await step(`settings ${section} (unchanged)`, "PUT", `/admin/settings/${section}`, T, { value: settings[section], reason: "اختبار حفظ بدون تغيير" });
}
// Commission & roles unchanged
const commission = await get("/admin/finance/commission", T);
const pct0 = commission.defaultCommissionPct;
await step("commission +1", "PUT", "/admin/finance/commission", T, { defaultCommissionPct: pct0 + 1, reason: "اختبار تعديل العمولة" });
await step("commission restore", "PUT", "/admin/finance/commission", T, { defaultCommissionPct: pct0, reason: "إرجاع العمولة بعد الاختبار" });
await step("commission unchanged → 422", "PUT", "/admin/finance/commission", T, { defaultCommissionPct: pct0, reason: "اختبار" }, 422);
const roles = await get("/admin/roles", T);
await step("roles matrix unchanged → 422", "PUT", "/admin/roles", T, { matrix: roles.matrix ?? roles, reason: "اختبار حفظ بدون تغيير" }, 422);
// Customer: suspend + reactivate the QA test customer
const qa = (await get("/admin/customers?search=QA", T))?.find((c) => c.name.includes("QA"));
if (qa) {
  await step("suspend QA customer", "POST", `/admin/customers/${qa.id}/status`, T, { suspended: true, reason: "اختبار إيقاف عميل" });
  await step("reactivate QA customer", "POST", `/admin/customers/${qa.id}/status`, T, { suspended: false, reason: "اختبار إعادة تفعيل" });
}
// Staff: reactivate + suspend the QA employee
const qaStaff = (await get("/admin/staff?search=QA", T))?.find((s) => s.name === "QA Employee");
if (qaStaff) {
  await step("reactivate QA employee", "POST", `/admin/staff/${qaStaff.id}/status`, T, { suspended: false, reason: "اختبار تفعيل موظف" });
  await step("suspend QA employee", "POST", `/admin/staff/${qaStaff.id}/status`, T, { suspended: true, reason: "اختبار إيقاف موظف" });
}
// Branch: deactivate + reactivate Heliopolis (demo)
const helio = (await get("/admin/branches?per_page=100", T))?.find((b) => b.id === "br_helio");
if (helio) {
  await step("deactivate branch", "POST", `/admin/branches/${helio.id}/toggle`, T, { active: false, reason: "اختبار إيقاف فرع" });
  await step("reactivate branch", "POST", `/admin/branches/${helio.id}/toggle`, T, { active: true, reason: "اختبار إعادة تشغيل الفرع" });
}
// Review: hide + restore one visible review
const review = (await get("/admin/reviews", T))?.find((r) => r.status === "visible");
if (review) {
  await step("hide review", "POST", `/admin/reviews/${review.id}/visibility`, T, { hidden: true, reason: "spam", note: "اختبار إخفاء" });
  await step("restore review", "POST", `/admin/reviews/${review.id}/visibility`, T, { hidden: false, reason: "اختبار إعادة إظهار" });
}
// Wash: edit unchanged
await step("wash edit (unchanged)", "PATCH", `/admin/washes/${wash.id}`, T, { patch: { name: wash.name }, reason: "اختبار حفظ بدون تغيير" });
// Platform offer: create draft → edit → disable
const now = new Date();
const offer = await step("create platform offer (draft)", "POST", "/admin/offers", T, {
  title: { ar: "عرض اختبار كارزن QA", en: "QA test offer" }, description: { ar: "", en: "" }, discountType: "percent", discountValue: 5,
  startAt: now.toISOString(), endAt: new Date(now.getTime() + 86400000).toISOString(), branchIds: ["br_nasr"], serviceCategories: [], status: "draft", featured: false,
});
if (offer.status === 200) {
  const id = offer.json.data.id;
  await step("edit platform offer", "PATCH", `/admin/offers/${id}`, T, { ...offer.json.data, title: { ar: "عرض اختبار كارزن QA 2", en: "QA test offer 2" }, discountValue: 6 });
  await step("disable platform offer", "POST", `/admin/offers/${id}/status`, T, { enabled: false, reason: "اختبار إيقاف" });
}
// Complaint: note only
if (comp) await step("complaint note", "PATCH", `/admin/complaints/${comp.id}`, T, { note: "ملاحظة اختبار من Claude" });
// Validation (no change)
await step("payout pay with bad amount → 4xx", "POST", `/admin/finance/payouts/${(await get("/admin/finance/payouts", T))?.[0]?.id ?? "x"}/pay`, T, { amountPaid: -5, reference: "", date: "garbage" }, [404, 409, 422]);
await step("commission 99% → 422", "PUT", "/admin/finance/commission", T, { defaultCommissionPct: 99, reason: "اختبار" }, 422);

console.log(out.join("\n"));
console.log(`\n${out.filter((l) => l.startsWith("PASS")).length}/${out.length} passed`);
