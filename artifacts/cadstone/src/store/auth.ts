import { create } from "zustand"

export type AuthUser = {
  id: string
  email: string
  fullName: string
  role: string
  avatarUrl: string | null
  phone: string | null
  createdAt?: string
  updatedAt?: string
}

type AuthState = {
  user: AuthUser | null
  accessToken: string | null
  setAuth: (user: AuthUser, accessToken: string) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  setAuth: (user, accessToken) => {
    set({
      user,
      accessToken,
    })
  },
  clearAuth: () => {
    set({
      user: null,
      accessToken: null,
    })
  },
}))
