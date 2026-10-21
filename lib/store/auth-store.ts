"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { AdminUser, SessionTokens } from "@/types/auth";

export const AUTH_STORE_KEY = "carzen-super-admin-auth-v1";

export type EstablishSessionInput = {
  admin: AdminUser;
  tokens: SessionTokens;
};

type AuthState = {
  admin: AdminUser | null;
  accessToken: string | null;
  tokenType: string;
  /** Renews the access token (Supabase tokens last an hour); null when the API has none. */
  refreshToken: string | null;
  /** Epoch ms the access token expires at; null = no expiry. */
  expiresAt: number | null;
  /** True once the persisted session has been read from storage. */
  hasHydrated: boolean;
  establishSession: (session: EstablishSessionInput) => void;
  setTokens: (tokens: SessionTokens) => void;
  setAdmin: (admin: AdminUser) => void;
  clearAuth: () => void;
};

function tokenState(tokens: SessionTokens) {
  return {
    accessToken: tokens.access_token,
    tokenType: tokens.token_type || "Bearer",
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      admin: null,
      accessToken: null,
      tokenType: "Bearer",
      refreshToken: null,
      expiresAt: null,
      hasHydrated: false,
      establishSession: ({ admin, tokens }) => set({ admin, ...tokenState(tokens) }),
      setTokens: (tokens) => set(tokenState(tokens)),
      setAdmin: (admin) => set({ admin }),
      clearAuth: () => set({ admin: null, accessToken: null, tokenType: "Bearer", refreshToken: null, expiresAt: null }),
    }),
    {
      name: AUTH_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Rehydrated manually after mount (AuthBootstrap) to avoid SSR mismatches.
      skipHydration: true,
      partialize: (state) => ({
        admin: state.admin,
        accessToken: state.accessToken,
        tokenType: state.tokenType,
        refreshToken: state.refreshToken,
        expiresAt: state.expiresAt,
      }),
      onRehydrateStorage: () => () => {
        useAuthStore.setState({ hasHydrated: true });
      },
    },
  ),
);

export function getAuthAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

export function getAuthTokenType(): string {
  return useAuthStore.getState().tokenType || "Bearer";
}
