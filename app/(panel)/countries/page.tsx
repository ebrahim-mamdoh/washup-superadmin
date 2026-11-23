import { Suspense } from "react";

import CountriesPageContent from "@/components/modules/Countries/CountriesPageContent";
import { getStaticPageMetadata } from "@/lib/config/pages";

export const metadata = getStaticPageMetadata("/countries");

export default function CountriesPage() {
  return (
    <Suspense>
      <CountriesPageContent />
    </Suspense>
  );
}
