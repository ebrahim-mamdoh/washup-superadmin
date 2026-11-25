"use client";

import axios, { type InternalAxiosRequestConfig } from "axios";

import { createApiFailureError, isApiFailureEnvelope } from "@/lib/api/api-error-handler";
import { WEB_CLIENT_HEADER, WEB_CLIENT_VALUE } from "@/lib/auth/session-cookies";
import { getApiBaseUrl } from "@/lib/config/api-base-url";
import { setServerNow } from "@/lib/format";
import { useAuthStore } from "@/lib/store/auth-store";

const REFRESH_PATH = "/admin/auth/refresh";
/** Renew the access cookie this long before it expires, so requests never race the expiry. */
const RENEW_BEFORE_MS = 60_000;

/**
 * Admin client. The session is carried by httpOnly cookies the same-origin API sets (GAP-063):
 * this script never sees a token. `X-Washup-Client: web` is what lets the API accept those
 * cookies (a cross-site page can't add it), so every request sends it.
 */
export const apiClient = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    [WEB_CLIENT_HEADER]: WEB_CLIENT_VALUE,
  },
  withCredentials: false,
});

/** Calls that must not trigger (or wait for) a session renewal. */
const isAuthCall = (url: string) => url.includes("/auth/login") || url.includes("/auth/refresh") || url.includes("/auth/logout");

let refreshing: Promise<boolean> | null = null;

async function requestRenewal(): Promise<boolean> {
  const { setExpiry, clearAuth } = useAuthStore.getState();
  try {
    // Plain axios: the refresh call must not go through these interceptors. The refresh cookie is the credential.
    const { data } = await axios.post<{ status: boolean; data: { expires_in?: number | null } | null }>(
      `${getApiBaseUrl()}${REFRESH_PATH}`,
      {},
      { headers: { "Content-Type": "application/json", Accept: "application/json", [WEB_CLIENT_HEADER]: WEB_CLIENT_VALUE } },
    );
    if (!data?.status) throw new Error("refresh failed");
    setExpiry(data.data?.expires_in);
    return true;
  } catch (error) {
    // A rejected refresh ends the session; a network error keeps it for the next try.
    if (!axios.isAxiosError(error) || error.response) clearAuth();
    return false;
  }
}

/** Renews the session once for every caller waiting on it; false when it can't be renewed. */
function renewSession(): Promise<boolean> {
  if (!refreshing) refreshing = requestRenewal().finally(() => (refreshing = null));
  return refreshing;
}

apiClient.interceptors.request.use(async (config) => {
  config.baseURL = getApiBaseUrl();
  const { admin, expiresAt } = useAuthStore.getState();
  if (!isAuthCall(String(config.url ?? "")) && admin && expiresAt && Date.now() > expiresAt - RENEW_BEFORE_MS) {
    await renewSession();
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    // Calibrate relative times/timers against the server clock.
    setServerNow(response.headers["x-demo-now"] as string | undefined);
    // Laravel can answer 200 with `{ status: false }` — treat it as a failure.
    if (isApiFailureEnvelope(response.data)) {
      return Promise.reject(createApiFailureError(response.data));
    }
    return response;
  },
  async (error) => {
    const status = error?.response?.status;
    const config = error?.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const url = String(config?.url ?? "");
    if (status === 401 && config && !isAuthCall(url) && useAuthStore.getState().admin) {
      // An expired access cookie: renew it once (refresh cookie) and replay; otherwise the session is over.
      if (!config._retried && (await renewSession())) {
        config._retried = true;
        return apiClient(config);
      }
      useAuthStore.getState().clearAuth();
    }
    return Promise.reject(error);
  },
);
