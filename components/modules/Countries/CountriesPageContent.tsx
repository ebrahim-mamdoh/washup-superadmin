"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getData, send } from "@/lib/api/request";
import { TONES } from "@/lib/constants/labels";

type Country = {
  code: string;
  name: { ar: string; en: string };
  currency: string;
  currencySymbol: { ar: string; en: string };
  currencyDecimals: number;
  timezone: string;
  dialCode: string;
  active: boolean;
};

export default function CountriesPageContent() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "countries"],
    queryFn: () => getData<Country[]>("/admin/countries"),
  });
  const [target, setTarget] = useState<Country | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!target) return;
    if (reason.trim().length < 3) {
      toast.error("اكتب سبب التفعيل أو الإيقاف");
      return;
    }
    setSaving(true);
    try {
      const res = await send("patch", `/admin/countries/${target.code}`, { active: !target.active, reason: reason.trim() });
      toast.success(res.message);
      setTarget(null);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "countries"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ الدولة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="الدول" description="تفعيل أو إيقاف دولة. العملة والمنطقة الزمنية للعرض فقط." />
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-4 py-2 text-start">الدولة</th>
              <th className="px-4 py-2 text-start">المفتاح</th>
              <th className="px-4 py-2 text-start">العملة</th>
              <th className="px-4 py-2 text-start">الخانات</th>
              <th className="px-4 py-2 text-start">التوقيت</th>
              <th className="px-4 py-2 text-start">الحالة</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={7}>
                  جاري التحميل…
                </td>
              </tr>
            ) : (
              (data ?? []).map((c) => (
                <tr key={c.code} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">
                    {c.name.ar}
                    <span className="ms-2 text-xs text-muted-foreground">{c.name.en}</span>
                  </td>
                  <td className="num px-4 py-3">{c.dialCode}</td>
                  <td className="px-4 py-3">
                    {c.currencySymbol.ar} <span className="text-xs text-muted-foreground">{c.currency}</span>
                  </td>
                  <td className="num px-4 py-3">{c.currencyDecimals}</td>
                  <td className="px-4 py-3 text-xs">{c.timezone}</td>
                  <td className="px-4 py-3">
                    <StatusBadge label={c.active ? "مفعّلة" : "موقوفة"} tone={c.active ? TONES.success : TONES.neutral} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Button variant="outline" size="sm" onClick={() => setTarget(c)}>
                      {c.active ? "إيقاف" : "تفعيل"}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target?.active ? "إيقاف" : "تفعيل"} {target?.name.ar}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="country-reason">السبب</Label>
            <Textarea id="country-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={saving}>
              {saving ? "جارٍ الحفظ…" : "تأكيد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
