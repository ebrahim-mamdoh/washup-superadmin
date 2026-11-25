"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { AdminSession } from "@/types/auth";

/**
 * Only the non-secret profile (name, role, permissions) and the access expiry are kept here, for
 * the UI. The tokens live in httpOnly cookies set by the API (GAP-063) and never reach this script.
 */
export const AUTH_STORE_KEY = "carzen-super-admin-auth-v2";
/** Earlier versions persisted the access + refresh tokens under this key; removed on load. */
export const LEGACY_AUTH_STORE_KEY = "carzen-super-admin-auth-v1";

export type EstablishSessionInput = {
  admin: AdminSession;
  /** Seconds the access cookie stays valid; null/undefined = no expiry. */
  expiresIn?: number | null;
};

type AuthState = {
  admin: AdminSession | null;
  /** Epoch ms the access cookie expires at (renewed shortly before); null = no expiry. */
  expiresAt: number | null;
  /** True once the persisted session has been read from storage. */
  hasHydrated: boolean;
  establishSession: (session: EstablishSessionInput) => void;
  setExpiry: (expiresIn?: number | null) => void;
  setAdmin: (admin: AdminSession) => void;
  clearAuth: () => void;
};

const expiryFrom = (expiresIn?: number | null) => (expiresIn ? Date.now() + expiresIn * 1000 : null);

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      admin: null,
      expiresAt: null,
      hasHydrated: false,
      establishSession: ({ admin, expiresIn }) => set({ admin, expiresAt: expiryFrom(expiresIn) }),
      setExpiry: (expiresIn) => set({ expiresAt: expiryFrom(expiresIn) }),
      setAdmin: (admin) => set({ admin }),
      clearAuth: () => set({ admin: null, expiresAt: null }),
    }),
    {
      name: AUTH_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Rehydrated manually after mount (AuthBootstrap) to avoid SSR mismatches.
      skipHydration: true,
      partialize: (state) => ({ admin: state.admin, expiresAt: state.expiresAt }),
      onRehydrateStorage: () => () => {
        useAuthStore.setState({ hasHydrated: true });
      },
    },
  ),
);

/** Deletes tokens a previous version left in localStorage (GAP-063). */
export function removeLegacyTokens() {
  try {
    localStorage.removeItem(LEGACY_AUTH_STORE_KEY);
  } catch {
    // Storage blocked: nothing was persisted there either.
  }
}
