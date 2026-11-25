import { type NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/session-cookies";

/**
 * Page requests (GAP-063):
 * 1. Server-side protection: a panel page without a session cookie redirects to /login?next=… before
 *    anything renders (`AdminAuthGate` stays as the second line; the API still checks every call).
 *    The refresh cookie counts too, so an idle tab whose access cookie lapsed renews instead of re-login.
 * 2. A per-request nonce CSP: Next reads the nonce from the request's CSP header and stamps it on its
 *    own scripts; with 'strict-dynamic' only those (and scripts they load: Maps, Leaflet, Firebase)
 *    may run, so injected markup can't execute script.
 */
const PUBLIC_PATHS = new Set(["/login"]);

const isDev = process.env.NODE_ENV === "development";
// The Maps JavaScript API's documented strict CSP includes 'unsafe-eval'; only allowed when Maps is on.
const mapsEnabled = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);

/**
 * External origins the panel really uses:
 * - Google Maps JS API (@vis.gl/react-google-maps): *.googleapis.com, *.gstatic.com, *.google.com, *.googleusercontent.com
 * - Leaflet fallback picker (no Maps key): unpkg.com (script + CSS + images), tile.openstreetmap.org (tiles)
 * - Firebase (Analytics + Cloud Messaging): *.googleapis.com (installations, FCM registrations, config),
 *   www.googletagmanager.com (gtag), *.google-analytics.com / *.analytics.google.com (collection)
 * The API is same-origin (/api/v1) and fonts are self-hosted by next/font.
 */
function contentSecurityPolicy(nonce: string, https: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev || mapsEnabled ? " 'unsafe-eval'" : ""} https://maps.googleapis.com https://unpkg.com https://www.googletagmanager.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
    "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com https://tile.openstreetmap.org https://unpkg.com https://www.googletagmanager.com https://*.google-analytics.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.google.com https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com data: blob:",
    "frame-src https://*.google.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  // Plain-http localhost (next dev / next start) must not have its own assets upgraded to https.
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!PUBLIC_PATHS.has(pathname) && !request.cookies.has(ACCESS_COOKIE) && !request.cookies.has(REFRESH_COOKIE)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, request.nextUrl.protocol === "https:");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the API (it authenticates every call itself), Next assets, or public files.
      source: "/((?!api/|_next/|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
