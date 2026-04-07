import { create } from "zustand";
import { setAccessToken } from "@/lib/api";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  avatarUrl?: string | null;
  phone?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isInitialized: boolean;
  setAuth: (user: AuthUser, token: string) => void;
  clearAuth: () => void;
  setInitialized: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isInitialized: false,
  setAuth: (user, token) => {
    setAccessToken(token);
    set({ user, accessToken: token });
  },
  clearAuth: () => {
    setAccessToken(null);
    set({ user: null, accessToken: null });
  },
  setInitialized: () => set({ isInitialized: true }),
}));
