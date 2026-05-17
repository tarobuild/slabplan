import {
  AxiosHeaders,
  isAxiosError,
  type InternalAxiosRequestConfig,
} from "axios"
import axios from "axios"
import { toast } from "sonner"
import { useAuthStore, type AuthUser } from "@/store/auth"
import { APP_STORAGE_NAMESPACE } from "@/lib/brand"

declare module "axios" {
  // Lets call sites opt out of the global "/403" navigation when they
  // legitimately expect a 403 (e.g. admin-only reference data fetched on
  // pages that non-admins are also allowed to view).
  interface AxiosRequestConfig {
    suppressForbiddenRedirect?: boolean
  }
}

export const FORBIDDEN_EVENT = `${APP_STORAGE_NAMESPACE}:forbidden`

type AuthResponse = {
  accessToken: string
  expiresIn?: number
  user: AuthUser
}

const defaultApiHeaders = {
  "X-Requested-With": "XMLHttpRequest",
}

export const authApi = axios.create({
  baseURL: "/api",
  headers: { ...defaultApiHeaders },
  withCredentials: true,
})

export const api = axios.create({
  baseURL: "/api",
  headers: { ...defaultApiHeaders },
  withCredentials: true,
})

let refreshPromise: Promise<string | null> | null = null
let interceptorsInitialized = false

function applyAuthorizationHeader(
  config: InternalAxiosRequestConfig,
  token: string,
) {
  const headers = AxiosHeaders.from(config.headers)
  headers.set("Authorization", `Bearer ${token}`)
  config.headers = headers
}

function setAuthFromResponse(payload: AuthResponse) {
  useAuthStore.getState().setAuth(payload.user, payload.accessToken)
  return payload.accessToken
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
        suppressForbiddenRedirect?: boolean
      }
      const requestUrl = request.url || ""
      const requestMethod = (request.method || "get").toLowerCase()

      if (
        error.response?.status === 403 &&
        !requestUrl.includes("/auth/") &&
        !request.suppressForbiddenRedirect
      ) {
        // Page-level reads (GET) that are forbidden mean the user landed on a
        // route they can't view at all → bounce them to /403. Mutations
        // (POST / PUT / PATCH / DELETE) usually fire from inside an open form
        // or dialog the user is already mid-way through; bouncing them away
        // from that work is hostile, so just toast the denial and let the
        // calling site surface the error inline.
        if (requestMethod === "get") {
          notifyForbidden()
        } else {
          notifyForbiddenAction()
        }
        return Promise.reject(error)
      }

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
        notifySessionExpired()
        return Promise.reject(error)
      }

      applyAuthorizationHeader(request, refreshedToken)
      return api(request)
    },
  )
}

initializeInterceptors()

let lastForbiddenAt = 0

function notifyForbidden() {
  const now = Date.now()
  // Debounce: a batch of parallel 403s (e.g. page load firing several queries)
  // should result in a single toast + one route change, not a cascade.
  if (now - lastForbiddenAt < 500) {
    return
  }
  lastForbiddenAt = now

  if (typeof window === "undefined") {
    return
  }

  toast.error("You don't have permission to view that.")
  window.dispatchEvent(new CustomEvent(FORBIDDEN_EVENT))
}

let lastForbiddenActionAt = 0

function notifyForbiddenAction() {
  // Same debounce strategy as notifyForbidden, but for write requests we only
  // want a toast — no navigation — so the user keeps their open form/dialog.
  const now = Date.now()
  if (now - lastForbiddenActionAt < 500) {
    return
  }
  lastForbiddenActionAt = now

  if (typeof window === "undefined") {
    return
  }

  toast.error("You don't have permission to do that.")
}

let lastSessionExpiredAt = 0

function notifySessionExpired() {
  const now = Date.now()
  // Debounce: a batch of parallel 401s (e.g. several queries firing on a
  // page load with an expired session) should result in a single toast,
  // not one per request. Per-call helpers like toastApiError treat 401 as
  // "handled here" so they don't fire their own copy.
  if (now - lastSessionExpiredAt < 500) {
    return
  }
  lastSessionExpiredAt = now

  if (typeof window === "undefined") {
    return
  }

  toast.error("Your session expired — please sign in again.")
}

export async function refreshSession(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    try {
      const { data } = await authApi.post<AuthResponse>("/auth/refresh")
      return setAuthFromResponse(data)
    } catch {
      useAuthStore.getState().clearAuth()
      return null
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export async function bootstrapAuthSession() {
  await refreshSession()
}

export async function logoutSession() {
  try {
    await authApi.post("/auth/logout")
  } finally {
    useAuthStore.getState().clearAuth()
  }
}
