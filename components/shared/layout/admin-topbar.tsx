"use client";

import { usePathname } from "next/navigation";
import { ChevronLeft, Menu, Search } from "lucide-react";

import { NotificationsMenu } from "@/components/shared/layout/notifications-menu";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { UserMenu } from "@/components/shared/layout/user-menu";
import { Button } from "@/components/ui/button";
import { ADMIN_NAV, isNavActive } from "@/lib/admin-nav";
import { useUIStore } from "@/lib/store/ui-store";

function useCurrentSection() {
  const pathname = usePathname();
  for (const group of ADMIN_NAV) {
    const item = group.items.find((i) => isNavActive(pathname, i));
    if (item) return { group: group.title, label: item.label };
  }
  return { group: null, label: "" };
}

/**
 * Three zones: breadcrumb at the start, search centred, actions at the end. The two side
 * zones share the leftover width equally (flex-1 basis-0), which keeps the search in the
 * middle of the bar whatever the breadcrumb's length.
 */
export function AdminTopbar() {
  const setMobileOpen = useUIStore((s) => s.setMobileNavOpen);
  const setCommandOpen = useUIStore((s) => s.setCommandOpen);
  const section = useCurrentSection();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/70 bg-background/80 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-w-0 items-center gap-2 md:flex-1 md:basis-0">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="فتح القائمة">
          <Menu className="size-5" />
        </Button>
        <nav aria-label="مسار التنقل" className="hidden min-w-0 items-center gap-2 text-sm md:flex">
          <span className="shrink-0 text-muted-foreground">{section.group ?? "لوحة التحكم"}</span>
          <ChevronLeft className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
          <span className="truncate font-semibold text-foreground">{section.label}</span>
        </nav>
      </div>

      {/* Below sm the search is an icon button, so the bar fits a 320px phone. */}
      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        aria-label="ابحث في المغاسل أو الحجوزات أو العملاء"
        className="ms-auto flex size-9 shrink-0 cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-input bg-card text-sm text-muted-foreground transition-colors hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none sm:h-10 sm:w-full sm:max-w-[560px] sm:shrink sm:justify-start sm:px-3.5 md:ms-0 md:flex-[1.4]"
      >
        <Search className="size-4 shrink-0 text-muted-foreground/70" />
        <span className="hidden truncate sm:inline">ابحث في المغاسل أو الحجوزات أو العملاء</span>
        <kbd className="ms-auto hidden rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:block">Ctrl K</kbd>
      </button>

      <div className="flex shrink-0 items-center justify-end gap-1.5 md:flex-1 md:basis-0">
        <div className="hidden sm:block">
          <ThemeToggle />
        </div>
        <NotificationsMenu />
        <UserMenu />
      </div>
    </header>
  );
}
