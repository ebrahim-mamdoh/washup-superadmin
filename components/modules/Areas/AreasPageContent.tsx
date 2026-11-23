"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { CountryFilter } from "@/components/shared/country-filter";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getData, send } from "@/lib/api/request";
import { TONES } from "@/lib/constants/labels";

const LocationPicker = dynamic(() => import("@/components/shared/maps/google-map").then((m) => m.LocationPicker), { ssr: false });

type Area = {
  id: string;
  name: { ar: string; en: string };
  countryCode: string;
  countryName: { ar: string; en: string };
  lat: number | null;
  lng: number | null;
  active: boolean;
  sortOrder: number;
};
type Country = { code: string; name: { ar: string }; lat: number; lng: number };

const EMPTY = { id: "", nameAr: "", nameEn: "", countryCode: "EG", lat: null as number | null, lng: null as number | null, active: true, sortOrder: 0 };

export default function AreasPageContent() {
  const queryClient = useQueryClient();
  const [country, setCountry] = useState("all");
  const areas = useQuery({
    queryKey: ["admin", "areas", country],
    queryFn: () => getData<Area[]>("/admin/areas", { country }),
  });
  const countries = useQuery({
    queryKey: ["admin", "countries"],
    queryFn: () => getData<Country[]>("/admin/countries"),
  });
  const [draft, setDraft] = useState<typeof EMPTY | null>(null);
  const [saving, setSaving] = useState(false);
  const center = useMemo(() => countries.data?.find((c) => c.code === draft?.countryCode), [countries.data, draft?.countryCode]);

  async function save() {
    if (!draft) return;
    if (draft.nameAr.trim().length < 2 || draft.nameEn.trim().length < 2) {
      toast.error("الاسم العربي والإنجليزي مطلوبان");
      return;
    }
    if (draft.lat == null || draft.lng == null) {
      toast.error("ضع دبوس المنطقة على الخريطة");
      return;
    }
    setSaving(true);
    try {
      const body = {
        nameAr: draft.nameAr.trim(),
        nameEn: draft.nameEn.trim(),
        countryCode: draft.countryCode,
        lat: draft.lat,
        lng: draft.lng,
        active: draft.active,
        sortOrder: Number(draft.sortOrder) || 0,
      };
      const res = draft.id
        ? await send("patch", `/admin/areas/${draft.id}`, body)
        : await send("post", "/admin/areas", body);
      toast.success(res.message);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "areas"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ المنطقة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="المناطق"
        description="كل منطقة لها دبوس. التطبيق يختار منطقة العميل بأقرب منطقة في حدود 25 كم."
        actions={<Button onClick={() => setDraft({ ...EMPTY, countryCode: country !== "all" ? country : "EG" })}>منطقة جديدة</Button>}
      />
      <CountryFilter value={country} onChange={setCountry} />
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-4 py-2 text-start">المنطقة</th>
              <th className="px-4 py-2 text-start">الدولة</th>
              <th className="px-4 py-2 text-start">الإحداثيات</th>
              <th className="px-4 py-2 text-start">الترتيب</th>
              <th className="px-4 py-2 text-start">الحالة</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(areas.data ?? []).map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{a.name.ar}</p>
                  <p className="text-xs text-muted-foreground">{a.name.en}</p>
                </td>
                <td className="px-4 py-3">{a.countryName?.ar}</td>
                <td className="num px-4 py-3 text-xs">
                  {a.lat ?? "—"}, {a.lng ?? "—"}
                </td>
                <td className="num px-4 py-3">{a.sortOrder}</td>
                <td className="px-4 py-3">
                  <StatusBadge label={a.active ? "فعّالة" : "موقوفة"} tone={a.active ? TONES.success : TONES.neutral} size="sm" />
                </td>
                <td className="px-4 py-3 text-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDraft({
                        id: a.id,
                        nameAr: a.name.ar,
                        nameEn: a.name.en,
                        countryCode: a.countryCode,
                        lat: a.lat,
                        lng: a.lng,
                        active: a.active,
                        sortOrder: a.sortOrder,
                      })
                    }
                  >
                    تعديل
                  </Button>
                </td>
              </tr>
            ))}
            {!areas.isLoading && !areas.data?.length ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                  لا توجد مناطق لهذه الدولة.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "تعديل المنطقة" : "منطقة جديدة"}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>الاسم بالعربية</Label>
                  <Input value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>الاسم بالإنجليزية</Label>
                  <Input value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>الدولة</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={draft.countryCode}
                    onChange={(e) => setDraft({ ...draft, countryCode: e.target.value })}
                  >
                    {(countries.data ?? []).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name.ar}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>الترتيب</Label>
                  <Input type="number" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                فعّالة
              </label>
              <LocationPicker
                value={draft.lat != null && draft.lng != null ? { lat: draft.lat, lng: draft.lng } : null}
                fallbackCenter={center ? { lat: center.lat, lng: center.lng } : undefined}
                onChange={(p) => setDraft({ ...draft, lat: p.lat, lng: p.lng })}
                className="h-64"
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={save} disabled={saving}>
              {saving ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
