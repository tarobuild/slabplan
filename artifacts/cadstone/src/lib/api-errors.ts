import { isAxiosError } from "axios"
import { toast } from "sonner"

export type ApiErrorClassification =
  | { kind: "forbidden" }
  | { kind: "session-expired" }
  | { kind: "toast"; message: string }

export function classifyApiError(
  err: unknown,
  fallback: string,
): ApiErrorClassification {
  if (isAxiosError(err)) {
    const status = err.response?.status
    const serverMessage =
      typeof err.response?.data === "object" && err.response?.data !== null
        ? (err.response.data as { message?: unknown }).message
        : undefined

    if (status === 401) {
      // The global axios interceptor attempts a token refresh and, on
      // failure, surfaces a single (debounced) "session expired" toast and
      // clears auth so the route guard sends the user back to /login.
      // Avoid double-toasting from here.
      return { kind: "session-expired" }
    }

    if (status === 403) {
      // The global axios interceptor already surfaces a 403 toast and
      // navigates the user away; avoid double-toasting from here.
      return { kind: "forbidden" }
    }

    if (typeof serverMessage === "string" && serverMessage.trim().length > 0) {
      return { kind: "toast", message: serverMessage }
    }

    if (status && status >= 500) {
      return {
        kind: "toast",
        message: "Server error — please try again in a moment.",
      }
    }

    if (err.code === "ERR_NETWORK" || err.message === "Network Error") {
      return {
        kind: "toast",
        message:
          "Couldn't reach the server. Check your connection and try again.",
      }
    }
  }

  if (err instanceof Error && err.message) {
    return { kind: "toast", message: err.message }
  }

  return { kind: "toast", message: fallback }
}

export function toastApiError(err: unknown, fallback: string): void {
  const classified = classifyApiError(err, fallback)
  if (classified.kind === "toast") {
    toast.error(classified.message)
  }
}

// Returns a string for inline error displays (e.g. setErrorMessage,
// setWeatherMessage). For 403s the global axios interceptor handles the
// redirect, so we just fall back to the caller-supplied label.
export function apiErrorMessage(err: unknown, fallback: string): string {
  const classified = classifyApiError(err, fallback)
  if (classified.kind === "toast") return classified.message
  return fallback
}
