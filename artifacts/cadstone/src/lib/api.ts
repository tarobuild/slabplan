import {
  AxiosHeaders,
  isAxiosError,
  type InternalAxiosRequestConfig,
} from "axios"
import axios from "axios"
import { useAuthStore, type AuthUser } from "@/store/auth"

type AuthResponse = {
  accessToken: string
  expiresIn?: number
  user: AuthUser
}

export const authApi = axios.create({
  baseURL: "/api",
  withCredentials: true,
})

export const api = axios.create({
  baseURL: "/api",
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
