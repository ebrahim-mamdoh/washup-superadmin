"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { send } from "@/lib/api/request";
import type { BranchListItem } from "@/types/washes";

const LocationPicker = dynamic(() => import("@/components/shared/maps/google-map").then((m) => m.LocationPicker), { ssr: false });

const LEGACY = { lat: 30.0131, lng: 31.4395 };

export function BranchLocationDialog({
  branch,
  open,
  onOpenChange,
  onSaved,
}: {
  branch: BranchListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const point = pin ?? (branch ? { lat: Number(branch.lat), lng: Number(branch.lng) } : null);
  const legacy = point && Math.abs(point.lat - LEGACY.lat) < 0.00005 && Math.abs(point.lng - LEGACY.lng) < 0.00005;

  async function save() {
    if (!branch || !point) return;
    if (legacy) {
      toast.error("حرّك الدبوس بعيدًا عن الإحداثيات الافتراضية");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("اكتب سبب تعديل الموقع");
      return;
    }
    setSaving(true);
    try {
      const res = await send("patch", `/admin/branches/${branch.id}/location`, { lat: point.lat, lng: point.lng, reason: reason.trim() });
      toast.success(res.message || "تم تحديث موقع الفرع");
      setPin(null);
      setReason("");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ الموقع");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>موقع {branch?.name.ar ?? "الفرع"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <LocationPicker value={point} onChange={setPin} className="h-64" />
          {legacy ? <p className="text-xs text-destructive">هذا هو الموقع الافتراضي القديم. حرّك الدبوس إلى العنوان الفعلي.</p> : null}
          <div className="space-y-1.5">
            <Label htmlFor="loc-reason">سبب التعديل</Label>
            <Textarea id="loc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: تصحيح موقع سُجّل بالإحداثيات الافتراضية" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "جارٍ الحفظ…" : "حفظ الموقع"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
