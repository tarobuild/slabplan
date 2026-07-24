import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  avatarUrl?: string | null;
  phone?: string | null;
};

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  hydrated: boolean;
  setSession: (session: {
    accessToken: string;
    refreshToken: string;
    user: AuthUser;
  }) => Promise<void>;
  setAccessToken: (accessToken: string) => void;
  clearSession: () => Promise<void>;
  hydrate: () => Promise<void>;
};

const REFRESH_TOKEN_KEY = "stone-track.mobile.refreshToken";
const USER_KEY = "stone-track.mobile.user";

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  hydrated: false,
  setSession: async ({ accessToken, refreshToken, user }) => {
    await Promise.all([
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
    ]);
    set({ accessToken, refreshToken, user, hydrated: true });
  },
  setAccessToken: (accessToken) => {
    set({ accessToken });
  },
  clearSession: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
    set({ accessToken: null, refreshToken: null, user: null, hydrated: true });
  },
  hydrate: async () => {
    const [refreshToken, storedUser] = await Promise.all([
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);

    if (!refreshToken || !storedUser) {
      set({ hydrated: true });
      return;
    }

    try {
      set({
        refreshToken,
        user: JSON.parse(storedUser) as AuthUser,
        hydrated: true,
      });
    } catch {
      await Promise.all([
        SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
        SecureStore.deleteItemAsync(USER_KEY),
      ]);
      set({ accessToken: null, refreshToken: null, user: null, hydrated: true });
    }
  },
}));
