"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, RotateCcw, ShieldCheck } from "lucide-react";

import { UserAvatar } from "@/components/shared/user-avatar";
import { ReasonDialog } from "@/components/shared/reason-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLogout } from "@/hooks/use-auth";
import { useResetDemoData } from "@/hooks/use-platform";
import { ADMIN_ROLE } from "@/lib/constants/labels";
import { canAccess } from "@/lib/admin-access";
import { useAuthStore } from "@/lib/store/auth-store";

export function UserMenu() {
  const router = useRouter();
  const admin = useAuthStore((s) => s.admin);
  const logout = useLogout();
  const reset = useResetDemoData();
  const [resetOpen, setResetOpen] = useState(false);

  if (!admin) return null;
  // Demo reset exists only on the bundled demo data, for Super Admin (GAP-046); the matrix link per role (GAP-012).
  const canReset = admin.demoData === true && admin.role === "super";
  const canSeeRoles = canAccess(admin, "roles");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="ms-1 cursor-pointer rounded-full ring-offset-2 ring-offset-background transition-shadow hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={`قائمة الحساب — ${admin.name}`}
        >
          <UserAvatar name={admin.name} size="md" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-1.5">
              <span className="block text-sm font-semibold text-foreground">{admin.name}</span>
              <span className="block text-xs font-normal text-muted-foreground">{ADMIN_ROLE[admin.role].label}</span>
              <span className="num block text-xs font-normal text-muted-foreground">{admin.email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {canSeeRoles ? (
            <DropdownMenuItem onClick={() => router.push("/roles")}>
              <ShieldCheck />
              الأدوار والصلاحيات
            </DropdownMenuItem>
          ) : null}
          {canReset ? (
            <DropdownMenuItem onClick={() => setResetOpen(true)}>
              <RotateCcw />
              إعادة ضبط بيانات العرض
            </DropdownMenuItem>
          ) : null}
          {canSeeRoles || canReset ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              logout.mutate(undefined, {
                onSettled: () => router.replace("/login"),
              })
            }
          >
            <LogOut />
            تسجيل الخروج
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ReasonDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="إعادة ضبط بيانات العرض؟"
        description="ستعود كل البيانات (المغاسل، الحجوزات، الشكاوى، سجل التدقيق…) لحالتها الأصلية. جلستك الحالية ستبقى مفتوحة."
        textLabel="ملاحظة"
        textRequired={false}
        confirmLabel="إعادة الضبط"
        variant="destructive"
        isPending={reset.isPending}
        onConfirm={() => reset.mutate(undefined, { onSuccess: () => setResetOpen(false) })}
      />
    </>
  );
}
