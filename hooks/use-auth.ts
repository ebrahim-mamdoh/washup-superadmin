"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { fetchMe, login, logout } from "@/lib/services/auth.service";
import { disablePush } from "@/lib/push/web-push";
import { useAuthStore } from "@/lib/store/auth-store";
import type { LoginPayload } from "@/types/auth";

/**
 * `isReady` = persisted profile read; `isAuthenticated` = a signed-in profile is present. The session
 * itself is an httpOnly cookie (GAP-063): `useMe` checks it with the API, and a 401 clears the profile.
 */
export function useAuthReady() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const admin = useAuthStore((s) => s.admin);
  return {
    isReady: hasHydrated,
    isAuthenticated: hasHydrated && admin !== null,
    admin,
  };
}

export function useLogin() {
  const establishSession = useAuthStore((s) => s.establishSession);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: LoginPayload) => login(payload),
    meta: { skipErrorToast: true },
    onSuccess: ({ data }) => {
      queryClient.clear();
      establishSession({ admin: data.admin, expiresIn: data.expires_in });
    },
  });
}

export function useLogout() {
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const queryClient = useQueryClient();

  return useMutation({
    // This browser stops receiving the account's pushes once signed out.
    mutationFn: async () => {
      await disablePush("admin").catch(() => undefined);
      return logout();
    },
    meta: { skipErrorToast: true },
    onSettled: () => {
      clearAuth();
      queryClient.clear();
    },
  });
}

/** Re-validates the persisted session against the API (401 clears it via the axios interceptor). */
export function useMe(enabled: boolean) {
  const setAdmin = useAuthStore((s) => s.setAdmin);
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const admin = await fetchMe();
      setAdmin(admin);
      return admin;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
