/**
 * Web session cookies (GAP-063). The browser never sees the tokens: the same-origin API
 * (`app/api/v1/[...path]/route.ts`) moves them from login/refresh responses into these httpOnly
 * cookies, and `proxy.ts` only checks that one of them exists before serving a panel page.
 * Names are app-specific because cookies are shared across ports on localhost (vendor runs beside it).
 */
export const ACCESS_COOKIE = "washup_sa_access";
export const REFRESH_COOKIE = "washup_sa_refresh";

/** Requests that may authenticate with the cookies must carry this header (CSRF defence). */
export const WEB_CLIENT_HEADER = "x-washup-client";
export const WEB_CLIENT_VALUE = "web";
