"use client";

import { ShieldOff } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { EmptyState } from "@/components/shared/states";
import { useCan } from "@/lib/admin-access";
import { ADMIN_NAV_ITEMS, isNavActive } from "@/lib/admin-nav";

/**
 * Hides a page the signed-in admin's role can't open (GAP-012). The API refuses those routes
 * anyway (403); this keeps the screen honest instead of showing load errors. An admin without
 * the dashboard lands on the first page their role allows.
 */
export function PagePermissionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const can = useCan();

  const item = ADMIN_NAV_ITEMS.filter((i) => isNavActive(pathname, i)).sort((a, b) => b.href.length - a.href.length)[0];
  const allowed = !item || can(item.permission);
  const fallback = allowed ? null : ADMIN_NAV_ITEMS.find((i) => can(i.permission));
  const redirectTo = !allowed && pathname === "/dashboard" && fallback ? fallback.href : null;

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  if (allowed) return <>{children}</>;
  if (redirectTo) return null;
  return (
    <EmptyState
      icon={<ShieldOff />}
      title="ليست لديك صلاحية لفتح هذه الصفحة"
      description="صلاحيات دورك لا تشمل هذا القسم. تواصل مع Super Admin إذا كنت تحتاجه."
    />
  );
}
