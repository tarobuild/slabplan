import { isAxiosError } from "axios"
import { ApiError } from "@workspace/api-client-react"
import { toast } from "sonner"

export type ApiErrorClassification =
  | { kind: "forbidden" }
  | { kind: "session-expired" }
  | { kind: "toast"; message: string }

// Generated mutation hooks throw `ApiError` (from customFetch) instead of an
// AxiosError. The shape carries problem+json on `.data` and the HTTP status
// on `.status`, so we surface both error families through one classifier.
function classifyGeneratedApiError(
  err: ApiError,
  fallback: string,
): ApiErrorClassification {
  const status = err.status
  if (status === 401) return { kind: "session-expired" }
  if (status === 403) return { kind: "forbidden" }

  const data = err.data
  const serverMessage = firstNonEmptyString(data, ["message", "detail", "title"])
  if (serverMessage) {
    return { kind: "toast", message: serverMessage }
  }
  if (status >= 500) {
    return {
      kind: "toast",
      message: "Server error — please try again in a moment.",
    }
  }
  return { kind: "toast", message: fallback }
}

function firstNonEmptyString(
  value: unknown,
  keys: readonly string[],
): string | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate
    }
  }
  return null
}

export function classifyApiError(
  err: unknown,
  fallback: string,
): ApiErrorClassification {
  if (err instanceof ApiError) {
    return classifyGeneratedApiError(err, fallback)
  }

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

// Extract the machine-readable code the API surfaces inside problem+json
// `errors` payloads (e.g. multer's `LIMIT_FILE_SIZE` from the upload
// middleware). Returns null when the response shape doesn't match so
// callers can fall back to the generic message handling.
export function apiErrorDetailCode(err: unknown): string | null {
  let data: unknown = null
  if (err instanceof ApiError) {
    data = err.data
  } else if (isAxiosError(err)) {
    data = err.response?.data
  }
  if (typeof data !== "object" || data === null) return null
  const errors = (data as { errors?: unknown }).errors
  if (typeof errors !== "object" || errors === null) return null
  const code = (errors as { code?: unknown }).code
  return typeof code === "string" ? code : null
}
