import type { Localized } from "../common";
import type { VendorNotificationType } from "./catalog";

/* Partner-portal record types the admin API still writes (see `./catalog.ts`). */

export interface VendorNotification {
  id: string;
  businessId: string;
  branchId: string | null;
  type: VendorNotificationType;
  title: Localized;
  body: Localized;
  href: string;
  read: boolean;
  createdAt: string;
}
