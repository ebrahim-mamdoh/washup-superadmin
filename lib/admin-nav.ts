import type { ComponentType } from "react";

import type { PermissionKey } from "@/types/admins";
import {
  BadgePercent,
  BriefcaseBusiness,
  CalendarCheck2,
  ChartPie,
  FileClock,
  FilePlus2,
  History,
  Globe,
  LayoutDashboard,
  Map,
  MapPinned,
  MessageSquareWarning,
  Receipt,
  Settings,
  ShieldCheck,
  Star,
  Store,
  Tag,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";

export type NavBadgeKey = "applications" | "complaints";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Roles-matrix module the page belongs to (hidden without view access, GAP-012). */
  permission: PermissionKey;
  /** Live count rendered as a pill (sourced from the dashboard summary). */
  badge?: NavBadgeKey;
  /** Extra path prefixes that should mark this item active. */
  match?: string[];
};

export type AdminNavGroup = {
  title: string | null;
  items: AdminNavItem[];
};

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    title: null,
    items: [{ href: "/dashboard", permission: "dashboard", label: "لوحة المؤشرات", icon: LayoutDashboard }],
  },
  {
    title: "المغاسل",
    items: [
      { href: "/washes", permission: "washes", label: "كل المغاسل", icon: Store },
      { href: "/applications", permission: "applications", label: "طلبات الانضمام", icon: FilePlus2, badge: "applications" },
      { href: "/branches", permission: "branches", label: "الفروع", icon: MapPinned },
      { href: "/areas", permission: "settings", label: "المناطق", icon: Map },
      { href: "/countries", permission: "settings", label: "الدول", icon: Globe },
    ],
  },
  {
    title: "العمليات",
    items: [
      { href: "/orders", permission: "orders", label: "الحجوزات والطلبات", icon: CalendarCheck2 },
      { href: "/complaints", permission: "complaints", label: "الشكاوى", icon: MessageSquareWarning, badge: "complaints" },
      { href: "/reviews", permission: "reviews", label: "التقييمات", icon: Star },
    ],
  },
  {
    title: "المستخدمون",
    items: [
      { href: "/customers", permission: "customers", label: "العملاء", icon: Users },
      { href: "/staff", permission: "staff", label: "الملاك والموظفون", icon: BriefcaseBusiness },
    ],
  },
  {
    title: "المالية والتسويق",
    items: [
      { href: "/finance", permission: "finance", label: "الملخص المالي", icon: ChartPie },
      { href: "/finance/transactions", permission: "finance", label: "المعاملات", icon: Receipt },
      { href: "/finance/commission", permission: "finance", label: "العمولات", icon: BadgePercent },
      { href: "/finance/payouts", permission: "finance", label: "تسويات العمولة", icon: Wallet },
      { href: "/offers", permission: "offers", label: "عروض المنصة", icon: Tag },
    ],
  },
  {
    title: "النظام",
    items: [
      { href: "/admins", permission: "admins", label: "المسؤولون", icon: UserCog },
      { href: "/roles", permission: "roles", label: "الأدوار والصلاحيات", icon: ShieldCheck },
      { href: "/settings", permission: "settings", label: "إعدادات المنصة", icon: Settings },
      { href: "/audit", permission: "audit", label: "سجل التدقيق", icon: History },
      { href: "/notifications", permission: "notifications", label: "الإشعارات", icon: FileClock },
    ],
  },
];

export function isNavActive(pathname: string, item: AdminNavItem): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  // `/finance` must not light up for `/finance/transactions`.
  if (item.href === "/finance") return path === "/finance";
  if (path === item.href || path.startsWith(`${item.href}/`)) return true;
  return item.match?.some((m) => path.startsWith(m)) ?? false;
}

/** Flattened list for breadcrumbs and the command palette's "Go to" group. */
export const ADMIN_NAV_ITEMS = ADMIN_NAV.flatMap((g) => g.items);
