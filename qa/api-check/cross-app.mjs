// Cross-app flows: Super Admin (adminBase) ↔ vendor portal (vendorBase), same Supabase database.
// Usage: node qa/api-check/cross-app.mjs <adminBase> <vendorBase> [--approve]
// Writes: a phone booking cancelled by the admin, Carzen Wash suspended then reactivated, a review reported
// then kept, a commission override set then restored. --approve also approves the oldest pending application.
const [adminBase, vendorBase] = process.argv.slice(2);
const out = [];
const log = (ok, name, detail = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
async function call(base, method, path, token, body) {
  const res = await fetch(`${base}/api/v1${path}`, { method, signal: AbortSignal.timeout(60000), headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, msg: json?.message };
}
const A = (m, p, b) => call(adminBase, m, p, admin, b);
const V = (t, m, p, b) => call(vendorBase, m, p, t, b);

const admin = (await call(adminBase, "POST", "/admin/auth/login", null, { email: "sara@carzen.demo", password: "demo1234" })).json.data.access_token;
const owner = (await call(vendorBase, "POST", "/vendor/auth/login", null, { phone: "01200000000", password: "demo1234" })).json.data;
const O = owner.access_token;
const br = "br_nasr";
const primary = (await V(O, "GET", `/vendor/services?branchId=${br}`)).json.data.find((s) => s.type === "primary" && s.active);

// 1. Vendor creates a phone booking → Super Admin sees it → admin cancels → vendor sees "cancelled by Carzen"
const tomorrow = new Date(Date.now() + 86400000);
const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
const slot = (await V(O, "GET", `/vendor/availability?branchId=${br}&date=${day}&serviceIds=${primary.id}`)).json.data.find((s) => !s.past && !s.blocked && s.free > 0);
const booking = await V(O, "POST", "/vendor/orders", { source: "phone", branchId: br, plate: "QA 0004", customerPhone: "01099990001", serviceIds: [primary.id], scheduledAt: slot.start });
log(booking.status === 200, "vendor creates phone booking", booking.msg);
const id = booking.json?.data?.id;
const seen = await A("GET", `/admin/orders/${id}`);
log(seen.status === 200, "admin sees the vendor booking", seen.json?.data?.order?.number);
const cancel = await A("POST", `/admin/orders/${id}/cancel`, { reason: "اختبار إلغاء من إدارة كارزن" });
log(cancel.status === 200, "admin cancels it", cancel.msg);
const after = (await V(O, "GET", `/vendor/orders/${id}`)).json?.data?.order;
log(after?.status === "cancelled" && after?.cancel?.byType === "admin", "vendor sees it cancelled by Carzen", `${after?.status} by ${after?.cancel?.byType}`);
const vn = (await V(O, "GET", "/vendor/notifications")).json?.data?.[0];
log(Boolean(vn), "vendor got a notification", vn?.title?.ar);

// 2. Admin suspends the wash → vendor banner state + new orders rejected (423) → admin reactivates
const sus = await A("POST", "/admin/washes/biz_carzen/suspend", { reason: "repeated_complaints", note: "اختبار تعليق من Claude", cancelUpcoming: false });
log(sus.status === 200, "admin suspends Carzen Wash", sus.msg);
const me = (await V(O, "GET", "/vendor/auth/me")).json?.data;
log(me?.businessStatus === "suspended", "vendor account shows suspended", me?.businessStatus);
const blocked = await V(O, "POST", "/vendor/orders", { source: "walk_in", branchId: br, plate: "QA 0005", serviceIds: [primary.id] });
log(blocked.status === 423, "vendor new order rejected while suspended (423)", `${blocked.status} ${blocked.msg}`);
if (blocked.status === 200) await V(O, "POST", `/vendor/orders/${blocked.json.data.id}/actions`, { action: "cancel", reason: "طلب اختبار — إلغاء" });
const re = await A("POST", "/admin/washes/biz_carzen/reactivate", { note: "انتهاء اختبار التعليق" });
log(re.status === 200, "admin reactivates", re.msg);
log((await V(O, "GET", "/vendor/auth/me")).json?.data?.businessStatus === "active", "vendor account active again");

// 3. Vendor reports a review → admin "reported" queue → admin keeps it visible
const review = (await V(O, "GET", "/vendor/reviews?branchId=all")).json.data.find((r) => !r.reportedByWash && r.status === "visible");
if (review) {
  const rep = await V(O, "POST", `/vendor/reviews/${review.id}/report`, { reason: "اختبار إبلاغ من المغسلة" });
  log(rep.status === 200, "vendor reports a review", rep.msg);
  const reported = (await A("GET", "/admin/reviews?filter=reported")).json.data.some((r) => r.id === review.id);
  log(reported, "admin sees it in the reported queue");
  const keep = await A("POST", `/admin/reviews/${review.id}/visibility`, { hidden: false, reason: "اختبار — إبقاء التقييم ظاهرًا" });
  log(keep.status === 200, "admin keeps it visible (report closed)", keep.msg);
  log(!(await A("GET", "/admin/reviews?filter=reported")).json.data.some((r) => r.id === review.id), "review left the reported queue");
}

// 4. Admin changes a vendor's commission override → vendor finance/settings show it → restore
const comm = (await A("GET", "/admin/finance/commission")).json.data;
const row = comm.washes.find((w) => w.businessId === "biz_carzen" || w.id === "biz_carzen");
const base = comm.defaultCommissionPct;
const set = await A("PUT", "/admin/finance/commission", { defaultCommissionPct: base, overrides: { biz_carzen: 9 }, reason: "اختبار عمولة خاصة" });
log(set.status === 200, "admin sets Carzen Wash commission to 9%", set.msg);
const vs = (await V(O, "GET", "/vendor/settings")).json.data.business.commissionRate;
log(vs === 9, "vendor settings show 9%", String(vs));
const restore = await A("PUT", "/admin/finance/commission", { defaultCommissionPct: base, overrides: { biz_carzen: row?.isOverride ? row.rate : null }, reason: "إرجاع العمولة بعد الاختبار" });
log(restore.status === 200, "admin restores commission", restore.msg);

// 5. Application approval → new wash + owner login → owner signs in to the vendor portal
const pending = process.argv.includes("--approve") ? (await A("GET", "/admin/applications?status=pending")).json.data[0] : null;
if (pending) {
  const appr = await A("POST", `/admin/applications/${pending.id}/approve`, { activateImmediately: false, note: "اعتماد تجريبي من Claude", checklist: ["1", "2", "3", "4", "5", "6"] });
  log(appr.status === 200, `admin approves application ${pending.businessName}`, appr.msg);
  const pw = /كلمة المرور المؤقتة: (\S+)/.exec(appr.msg ?? "")?.[1];
  if (pw) {
    const ownerLogin = await call(vendorBase, "POST", "/vendor/auth/login", null, { phone: pending.phone, password: pw });
    log(ownerLogin.status === 200, "new owner signs in to the vendor portal", `${ownerLogin.status} ${ownerLogin.msg} ${ownerLogin.json?.data?.account?.businessStatus ?? ""}`);
    const welcome = (await V(ownerLogin.json?.data?.access_token, "GET", "/vendor/notifications")).json?.data?.[0]?.title?.ar;
    log(Boolean(welcome), "new owner has the welcome notification", welcome);
  } else log(false, "temporary password returned", appr.msg);
}

console.log(out.join("\n"));
console.log(`\n${out.filter((l) => l.startsWith("PASS")).length}/${out.length} passed`);
