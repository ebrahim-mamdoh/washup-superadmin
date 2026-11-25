"use client";

import { useState } from "react";
import { FilePlus2 } from "lucide-react";

import { ReasonDialog } from "@/components/shared/reason-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGenerateSettlements } from "@/hooks/use-finance";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Last full Monday–Sunday week (the period the weekly job also builds). */
function lastWeek() {
  const today = new Date();
  const sinceMonday = (today.getDay() + 6) % 7;
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday - 1);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
  return { start: iso(start), end: iso(end) };
}

/**
 * GAP-020: builds the commission settlements of a period on demand (one per wash and currency, from
 * paid ledger rows not yet in a settlement). A weekly job does the same for the previous week.
 */
export function GenerateSettlementsButton() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(lastWeek);
  const generate = useGenerateSettlements(() => setOpen(false));
  const invalid = !period.start || !period.end || period.end < period.start;

  return (
    <>
      <Button size="lg" variant="outline" onClick={() => setOpen(true)}>
        <FilePlus2 />
        إنشاء تسويات
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="إنشاء تسويات العمولة لفترة"
        description="تُنشأ تسوية مفتوحة لكل مغسلة وعملة من المعاملات المدفوعة في الفترة التي لم تدخل تسوية بعد. لا تتكرر المعاملات بين التسويات."
        textLabel="السبب"
        minLength={5}
        confirmLabel="إنشاء التسويات"
        isPending={generate.isPending}
        onConfirm={({ text }) => {
          if (invalid) return;
          generate.mutate({ periodStart: period.start, periodEnd: period.end, reason: text.trim() });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="settle-start" className="text-xs font-medium">
              بداية الفترة
            </label>
            <Input id="settle-start" type="date" className="num h-9" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="settle-end" className="text-xs font-medium">
              نهاية الفترة
            </label>
            <Input
              id="settle-end"
              type="date"
              className="num h-9"
              value={period.end}
              aria-invalid={invalid}
              onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
            />
          </div>
          {invalid ? <p className="text-xs text-destructive sm:col-span-2">نهاية الفترة يجب أن تكون بعد بدايتها</p> : null}
        </div>
      </ReasonDialog>
    </>
  );
}
