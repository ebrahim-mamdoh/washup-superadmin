import { Suspense } from "react";

import AreasPageContent from "@/components/modules/Areas/AreasPageContent";
import { getStaticPageMetadata } from "@/lib/config/pages";

export const metadata = getStaticPageMetadata("/areas");

export default function AreasPage() {
  return (
    <Suspense>
      <AreasPageContent />
    </Suspense>
  );
}
