import "server-only";

import { type NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE, REFRESH_COOKIE, WEB_CLIENT_HEADER, WEB_CLIENT_VALUE } from "@/lib/auth/session-cookies";

/**
 * Cookie sessions for the panel in the browser (GAP-063), wrapped around the API handler so the
 * mock and Supabase data sources stay untouched (they keep speaking Bearer + JSON tokens):
 *
 * - login / refresh from the web client: the tokens are moved out of the JSON body into httpOnly,
 *   SameSite=Strict cookies, so no script on the page can read them;
 * - a web request without an `Authorization` header is authenticated with the access cookie, and a
 *   web refresh uses the refresh cookie. Both require `X-Washup-Client: web` — a custom header a
 *   cross-site form or link cannot send (CSRF defence on top of SameSite=Strict);
 * - logout clears the cookies. Clients sending their own Bearer token (mobile, scripts) are unchanged.
 */
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;
/** Same cap as the API's MAX_BODY_BYTES. */
const MAX_FORWARD_BYTES = 1_000_000;

type Action = "login" | "refresh" | "logout" | null;

function authAction(segments: string[]): Action {
  if (segments.length !== 3 || segments[0] !== "admin" || segments[1] !== "auth") return null;
  const action = segments[2];
  return action === "login" || action === "refresh" || action === "logout" ? action : null;
}

/** Secure everywhere except plain-http localhost (local `next dev` / `next start`). */
function isSecure(req: NextRequest): boolean {
  const { protocol, hostname } = req.nextUrl;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return !(protocol === "http:" && local);
}

function cookieOptions(req: NextRequest, maxAge: number) {
  return { httpOnly: true, secure: isSecure(req), sameSite: "strict" as const, path: "/", maxAge };
}

function clearCookies(req: NextRequest, res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, "", cookieOptions(req, 0));
  res.cookies.set(REFRESH_COOKIE, "", cookieOptions(req, 0));
}

/** The request the API handler sees: cookie credentials turned into what it already understands. */
async function forwardedRequest(req: NextRequest, action: Action): Promise<Request> {
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  const useAccess = Boolean(access) && !req.headers.has("authorization");
  const useRefresh = action === "refresh" && Boolean(refresh);
  // Oversized bodies are passed through untouched: the API refuses them (413) before reading.
  if ((!useAccess && !useRefresh) || Number(req.headers.get("content-length") ?? 0) > MAX_FORWARD_BYTES) return req;

  const headers = new Headers(req.headers);
  if (useAccess) headers.set("authorization", `Bearer ${access}`);
  const raw = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer();
  let body: BodyInit | null = raw;
  if (useRefresh) {
    let json: Record<string, unknown> = {};
    try {
      const parsed: unknown = raw?.byteLength ? JSON.parse(new TextDecoder().decode(raw)) : {};
      if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
    } catch {
      // Not JSON: the cookie is the only credential that matters for a web refresh.
    }
    if (!json.refresh_token) {
      body = JSON.stringify({ ...json, refresh_token: refresh });
      headers.set("content-type", "application/json");
      headers.delete("content-length");
    }
  }
  return new Request(req.url, { method: req.method, headers, body });
}

type TokenData = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };

/** Login/refresh success for the web: tokens → cookies, and stripped from the JSON the page receives. */
async function moveTokensToCookies(req: NextRequest, res: Response): Promise<Response> {
  let payload: { status?: unknown; data?: TokenData & Record<string, unknown> } | null = null;
  try {
    payload = await res.clone().json();
  } catch {
    return res;
  }
  const data = payload?.data;
  if (!res.ok || payload?.status !== true || !data || typeof data.access_token !== "string") return res;

  const { access_token: accessToken, refresh_token: refreshToken, ...rest } = data;
  const expiresIn = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : null;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  const out = NextResponse.json({ ...payload, data: rest }, { status: res.status, headers });
  // The access cookie lives as long as the token (mock tokens never expire: as long as the session).
  out.cookies.set(ACCESS_COOKIE, accessToken, cookieOptions(req, expiresIn ?? REFRESH_MAX_AGE));
  if (typeof refreshToken === "string" && refreshToken) {
    out.cookies.set(REFRESH_COOKIE, refreshToken, cookieOptions(req, REFRESH_MAX_AGE));
  }
  return out;
}

export async function withWebSession(
  req: NextRequest,
  segments: string[],
  handle: (req: Request) => Promise<Response>,
): Promise<Response> {
  if (req.headers.get(WEB_CLIENT_HEADER) !== WEB_CLIENT_VALUE) return handle(req);

  const action = authAction(segments);
  const res = await handle(await forwardedRequest(req, action));

  if (action === "login" || action === "refresh") {
    if (res.ok) return moveTokensToCookies(req, res);
    // A rejected refresh token ends the session: drop the cookies so pages stop treating it as live.
    if (action === "refresh" && res.status === 401) {
      const out = new NextResponse(res.body, { status: res.status, headers: res.headers });
      clearCookies(req, out);
      return out;
    }
    return res;
  }
  if (action === "logout") {
    const out = new NextResponse(res.body, { status: res.status, headers: res.headers });
    clearCookies(req, out);
    return out;
  }
  return res;
}
