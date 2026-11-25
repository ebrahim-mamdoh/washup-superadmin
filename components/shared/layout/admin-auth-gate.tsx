"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { BrandLogo } from "@/components/shared/brand-logo";
import { useAuthReady, useMe } from "@/hooks/use-auth";

/**
 * Second line behind `proxy.ts` (which redirects page requests without a session cookie): waits for
 * the persisted profile, then either renders the panel or sends the visitor to /login with a return
 * path. The session is an httpOnly cookie (GAP-063); `useMe` validates it and a 401 clears the profile.
 */
export function AdminAuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isReady, isAuthenticated } = useAuthReady();

  // Validates the session cookie once per session; a 401 (after one renewal attempt) clears it.
  useMe(isAuthenticated);

  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isReady, isAuthenticated, pathname, router]);

  if (!isReady || !isAuthenticated) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5">
        <BrandLogo subtitle="لوحة السوبر أدمن" />
        <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
          <div className="bg-brand-gradient h-full w-1/2 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full" />
        </div>
        <span className="sr-only">جاري التحقق من الجلسة</span>
      </div>
    );
  }

  return <>{children}</>;
}
