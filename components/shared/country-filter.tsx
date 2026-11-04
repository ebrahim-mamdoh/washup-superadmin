"use client";

import { useQuery } from "@tanstack/react-query";
import { Globe } from "lucide-react";

import { SelectFilter } from "@/components/shared/select-filter";
import { getData } from "@/lib/api/request";

type Country = { code: string; name: { ar: string; en: string } };

export function CountryFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { data } = useQuery({
    queryKey: ["admin", "countries"],
    queryFn: () => getData<Country[]>("/admin/countries", undefined, "تعذر تحميل الدول"),
    staleTime: 5 * 60_000,
  });

  return (
    <SelectFilter
      aria-label="الدولة"
      icon={<Globe className="size-4" />}
      value={value || "all"}
      onChange={onChange}
      allLabel="كل الدول"
      options={(data ?? []).map((c) => ({ value: c.code, label: c.name.ar }))}
    />
  );
}

