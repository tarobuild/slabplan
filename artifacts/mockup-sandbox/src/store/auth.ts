import {
  AxiosHeaders,
  isAxiosError,
  type InternalAxiosRequestConfig,
} from "axios"
import { create } from "zustand"
import { api, authApi } from "@/lib/api"

export type AuthUser = {
  id: string
  email: string
  fullName: string
  role: string
  avatarUrl: string | null
  phone: string | null
  createdAt: string
  updatedAt: string
}

type AuthResponse = {
  accessToken: string
  expiresIn: number
  user: AuthUser
}

type AuthState = {
  initialized: boolean
  status: "checking" | "authenticated" | "anonymous"
  accessToken: string | null
  user: AuthUser | null
  setSession: (payload: AuthResponse) => void
  clearSession: () => void
  setChecking: () => void
  updateUser: (user: AuthUser) => void
}

let refreshTimeout: number | null = null
let refreshPromise: Promise<string | null> | null = null
let bootstrapPromise: Promise<void> | null = null
let interceptorsInitialized = false

function clearRefreshTimeout() {
  if (refreshTimeout !== null) {
    window.clearTimeout(refreshTimeout)
    refreshTimeout = null
  }
}

function decodeJwtExpiry(token: string): number | null {
  try {
    const [, payload] = token.split(".")

    if (!payload) {
      return null
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    const parsed = JSON.parse(window.atob(padded)) as { exp?: number }

    return typeof parsed.exp === "number" ? parsed.exp * 1000 : null
  } catch {
    return null
  }
}

function scheduleTokenRefresh(token: string | null) {
  clearRefreshTimeout()

  if (!token) {
    return
  }

  const expiry = decodeJwtExpiry(token)

  if (!expiry) {
    return
  }

  const delay = Math.max(expiry - Date.now() - 60_000, 5_000)
  refreshTimeout = window.setTimeout(() => {
    void refreshSession()
  }, delay)
}

export const useAuthStore = create<AuthState>((set) => ({
  initialized: false,
  status: "checking",
  accessToken: null,
  user: null,
  setSession: (payload) => {
    scheduleTokenRefresh(payload.accessToken)
    set({
      initialized: true,
      status: "authenticated",
      accessToken: payload.accessToken,
      user: payload.user,
    })
  },
  clearSession: () => {
    clearRefreshTimeout()
    set({
      initialized: true,
      status: "anonymous",
      accessToken: null,
      user: null,
    })
  },
  setChecking: () => {
    set((state) => ({
      ...state,
      status: "checking",
    }))
  },
  updateUser: (user) => {
    set((state) => ({
      ...state,
      user,
    }))
  },
}))

function applyAuthorizationHeader(
  config: InternalAxiosRequestConfig,
  token: string,
) {
  const headers = AxiosHeaders.from(config.headers)
  headers.set("Authorization", `Bearer ${token}`)
  config.headers = headers
}

function initializeInterceptors() {
  if (interceptorsInitialized) {
    return
  }

  interceptorsInitialized = true

  api.interceptors.request.use((config) => {
    const token = useAuthStore.getState().accessToken

    if (token) {
      applyAuthorizationHeader(config, token)
    }

    return config
  })

  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      if (!isAxiosError(error) || !error.config) {
        return Promise.reject(error)
      }

      const request = error.config as InternalAxiosRequestConfig & {
        _retry?: boolean
      }
      const requestUrl = request.url || ""

      if (
        error.response?.status !== 401 ||
        request._retry ||
        requestUrl.includes("/auth/")
      ) {
        return Promise.reject(error)
      }

      request._retry = true

      const refreshedToken = await refreshSession()

      if (!refreshedToken) {
        return Promise.reject(error)
      }

      applyAuthorizationHeader(request, refreshedToken)
      return api(request)
    },
  )
}

initializeInterceptors()

function getErrorMessage(error: unknown, fallback: string) {
  if (!isAxiosError(error)) {
    return fallback
  }

  const message = error.response?.data?.message
  return typeof message === "string" ? message : fallback
}

export async function refreshSession(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    try {
      const { data } = await authApi.post<AuthResponse>("/auth/refresh")
      useAuthStore.getState().setSession(data)
      return data.accessToken
    } catch {
      useAuthStore.getState().clearSession()
      return null
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export async function bootstrapAuth() {
  if (bootstrapPromise || useAuthStore.getState().initialized) {
    return bootstrapPromise
  }

  useAuthStore.getState().setChecking()

  bootstrapPromise = (async () => {
    await refreshSession()
  })().finally(() => {
    bootstrapPromise = null
  })

  return bootstrapPromise
}

export async function login(credentials: {
  email: string
  password: string
}) {
  try {
    const { data } = await authApi.post<AuthResponse>("/auth/login", credentials)
    useAuthStore.getState().setSession(data)
    return data
  } catch (error) {
    throw new Error(getErrorMessage(error, "Unable to sign in."))
  }
}

export async function registerAccount(input: {
  email: string
  password: string
  full_name: string
}) {
  try {
    const { data } = await authApi.post<AuthResponse>("/auth/register", input)
    useAuthStore.getState().setSession(data)
    return data
  } catch (error) {
    throw new Error(getErrorMessage(error, "Unable to create your account."))
  }
}

export async function logout() {
  try {
    await authApi.post("/auth/logout")
  } finally {
    useAuthStore.getState().clearSession()
  }
}

export function updateAuthUser(user: AuthUser) {
  useAuthStore.getState().updateUser(user)
}
