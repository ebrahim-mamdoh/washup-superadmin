import { getData, send } from "@/lib/api/request";
import type { AdminSession, LoginPayload, LoginResponse } from "@/types/auth";

export function login(payload: LoginPayload) {
  return send<LoginResponse>("post", "/admin/auth/login", payload, "تعذر تسجيل الدخول");
}

export function fetchMe() {
  return getData<AdminSession>("/admin/auth/me", undefined, "تعذر تحميل بيانات الحساب");
}

export function logout() {
  return send<null>("post", "/admin/auth/logout");
}
