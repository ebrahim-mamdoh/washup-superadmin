import type { NextRequest } from "next/server";

import { handleMockRequest } from "@/server/platform-api";
import { withWebSession } from "@/server/web-session";

/**
 * Mock Carzen admin API (`/api/v1/*`).
 * Stands in for the Laravel backend until it exists — point NEXT_PUBLIC_API_URL
 * at the real API and this route is simply never called.
 * Browser sessions ride on httpOnly cookies (GAP-063, `server/web-session.ts`).
 */
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, { params }: RouteContext) {
  const { path } = await params;
  return withWebSession(req, path, (forwarded) => handleMockRequest(forwarded, path));
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
