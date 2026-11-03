import { getData } from "@/lib/api/request";
import type { DashboardPeriod, DashboardSummary } from "@/types/dashboard";

export function fetchDashboard(period: DashboardPeriod, country = "all") {
  return getData<DashboardSummary>("/admin/dashboard", { period, country }, "تعذر تحميل لوحة المؤشرات");
}
