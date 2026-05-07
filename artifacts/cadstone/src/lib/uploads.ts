import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_COUNT,
  formatUploadSize,
} from "@workspace/api-zod"

export type UploadMediaType = "document" | "photo" | "video" | "any"

// The size and count limits live in @workspace/api-zod so the file picker
// and the multer config on the server cannot drift apart. Keep the legacy
// names as re-exports so existing call sites don't churn.
export const UPLOAD_MAX_FILE_SIZE_BYTES = MAX_UPLOAD_FILE_BYTES
export const UPLOAD_MAX_FILES = MAX_UPLOAD_FILE_COUNT

const documentExtensions = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".txt",
  ".csv",
  ".tsv",
  ".md",
  ".rtf",
  ".json",
]

const photoExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".bmp",
  ".svg",
]
const videoExtensions = [".mp4", ".mov", ".avi", ".webm", ".m4v"]

const documentMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/rtf",
  "text/rtf",
  "application/json",
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "text/markdown",
  "text/x-markdown",
])

const photoMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  "image/tiff",
  "image/x-tiff",
  "image/bmp",
  "image/x-bmp",
  "image/x-ms-bmp",
  "image/svg+xml",
  "image/svg",
])

const videoMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-m4v",
])

const documentAcceptMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/rtf",
  "application/json",
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "text/markdown",
]

function lowerExtension(fileName: string) {
  const index = fileName.lastIndexOf(".")
  return index >= 0 ? fileName.slice(index).toLowerCase() : ""
}

const formatMaxFileSize = formatUploadSize

function isAllowedDocumentMimeType(value: string) {
  return (
    documentMimeTypes.has(value) ||
    value.startsWith("application/vnd.openxmlformats-officedocument.") ||
    value.startsWith("application/vnd.oasis.opendocument.")
  )
}

// Some browsers and OS combinations report a generic MIME type for
// perfectly valid documents (Windows file picker for `.docx`, Safari
// for `.csv`, etc.). The server still does the authoritative magic-byte
// check, so when the extension is one we accept we treat an empty or
// `application/octet-stream` MIME as plausibly a document and let the
// upload through instead of dead-ending the user with a confusing toast.
function isLikelyDocumentMimeType(value: string) {
  if (isAllowedDocumentMimeType(value)) return true
  if (value.startsWith("text/")) return true
  if (value === "application/zip" || value === "application/x-zip-compressed") {
    // .docx / .xlsx / .pptx surface this MIME in some pickers; the
    // server's magic-byte sniffer will verify it's a real Office
    // container before storage.
    return true
  }
  return value === "" || value === "application/octet-stream"
}

function isLikelyPhotoMimeType(value: string) {
  if (photoMimeTypes.has(value)) return true
  if (value.startsWith("image/")) return true
  return value === "" || value === "application/octet-stream"
}

function invalidTypeMessage(mediaType: UploadMediaType) {
  if (mediaType === "photo") {
    return "Photos must be image files (.jpg, .png, .gif, .webp, .heic, .tiff, .bmp, .svg)."
  }

  if (mediaType === "video") {
    return "Videos must be video files (.mp4, .mov, .avi, .webm)."
  }

  if (mediaType === "any") {
    return "File type not supported. Use a photo, video, or document."
  }

  return "Documents must be supported office, text, or PDF files."
}

export function uploadAcceptForMediaType(mediaType: UploadMediaType) {
  if (mediaType === "photo") {
    return [...photoExtensions, ...photoMimeTypes].join(",")
  }

  if (mediaType === "video") {
    return [...videoExtensions, ...videoMimeTypes].join(",")
  }

  if (mediaType === "any") {
    return [
      ...documentExtensions,
      ...photoExtensions,
      ...videoExtensions,
      ...documentAcceptMimeTypes,
      ...photoMimeTypes,
      ...videoMimeTypes,
    ].join(",")
  }

  return [...documentExtensions, ...documentAcceptMimeTypes].join(",")
}

export function validateSelectedFiles(
  files: File[],
  mediaType: UploadMediaType,
  options?: {
    maxFileSizeBytes?: number
    maxFiles?: number
  },
) {
  const maxFileSizeBytes = options?.maxFileSizeBytes ?? UPLOAD_MAX_FILE_SIZE_BYTES
  const maxFiles = options?.maxFiles ?? UPLOAD_MAX_FILES

  if (files.length > maxFiles) {
    return `You can upload up to ${maxFiles} files at a time.`
  }

  for (const file of files) {
    if (file.size > maxFileSizeBytes) {
      return `${file.name} exceeds the ${formatMaxFileSize(maxFileSizeBytes)} file size limit.`
    }

    const extension = lowerExtension(file.name)
    const mimeType = file.type.toLowerCase()

    const isAllowed =
      mediaType === "photo"
        ? photoExtensions.includes(extension) && isLikelyPhotoMimeType(mimeType)
        : mediaType === "video"
          ? videoExtensions.includes(extension) && videoMimeTypes.has(mimeType)
          : mediaType === "any"
            ? (photoExtensions.includes(extension) && isLikelyPhotoMimeType(mimeType)) ||
              (videoExtensions.includes(extension) && videoMimeTypes.has(mimeType)) ||
              (documentExtensions.includes(extension) && isLikelyDocumentMimeType(mimeType))
            : documentExtensions.includes(extension) && isLikelyDocumentMimeType(mimeType)

    if (!isAllowed) {
      return `${file.name}: ${invalidTypeMessage(mediaType)}`
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// XHR-based upload helper with progress, abort, and retry-on-401.
// ---------------------------------------------------------------------------
//
// `fetch` can't report upload progress, so big files leave the user
// staring at a frozen "Uploading…" spinner. This helper wraps
// XMLHttpRequest so the UI can render a real progress bar, retry
// transient failures (network drops, 5xx, request timeout), and on a
// single 401 silently re-auth and re-send the multipart body without
// asking the user to re-pick the file.

import { refreshSession } from "./api"
import { useAuthStore } from "@/store/auth"

export interface UploadProgress {
  loaded: number
  total: number
  percent: number
}

export interface UploadOptions {
  url: string
  formData: FormData
  /** Called as bytes are flushed to the server. */
  onProgress?: (progress: UploadProgress) => void
  /** Surface intermediate retry attempts so the UI can say "Retrying…". */
  onRetry?: (attempt: number, reason: string) => void
  /** Abort controller — calling abort() cancels the in-flight request. */
  signal?: AbortSignal
  /** Override max retry attempts (default 3). */
  maxAttempts?: number
}

export interface UploadError extends Error {
  status?: number
  code?: string
  details?: unknown
}

function makeUploadError(
  message: string,
  status?: number,
  code?: string,
  details?: unknown,
): UploadError {
  const err = new Error(message) as UploadError
  err.status = status
  err.code = code
  err.details = details
  return err
}

const RETRY_DELAYS_MS = [1000, 3000, 8000]

function isTransientStatus(status: number | undefined): boolean {
  if (status === undefined) return true
  if (status >= 500 && status < 600) return true
  if (status === 408 || status === 425 || status === 429) return true
  return false
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeUploadError("Upload aborted", undefined, "UPLOAD_ABORTED"))
      return
    }
    const handle = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(handle)
      reject(makeUploadError("Upload aborted", undefined, "UPLOAD_ABORTED"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

interface XhrAttemptResult<T> {
  ok: true
  data: T
}
interface XhrAttemptError {
  ok: false
  error: UploadError
}

function sendOnce<T>(opts: UploadOptions): Promise<XhrAttemptResult<T> | XhrAttemptError> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    const token = useAuthStore.getState().accessToken

    xhr.open("POST", `/api${opts.url}`, true)
    xhr.withCredentials = true
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest")
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`)
    }
    xhr.responseType = "text"

    if (opts.onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return
        opts.onProgress!({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        })
      })
    }

    const onAbort = () => {
      try {
        xhr.abort()
      } catch {
        /* ignore */
      }
    }
    if (opts.signal) {
      if (opts.signal.aborted) {
        resolve({
          ok: false,
          error: makeUploadError("Upload aborted", undefined, "UPLOAD_ABORTED"),
        })
        return
      }
      opts.signal.addEventListener("abort", onAbort, { once: true })
    }

    xhr.onload = () => {
      opts.signal?.removeEventListener("abort", onAbort)
      const status = xhr.status
      const text = xhr.responseText || ""
      let parsed: unknown = null
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = text
      }

      if (status >= 200 && status < 300) {
        resolve({ ok: true, data: parsed as T })
        return
      }

      const problem = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
      const detail =
        (problem?.detail as string | undefined) ||
        (problem?.message as string | undefined) ||
        `Upload failed with status ${status}.`
      const errors = problem?.errors as Record<string, unknown> | undefined
      const code = (errors?.code as string | undefined) ?? deriveDefaultCode(status)
      resolve({
        ok: false,
        error: makeUploadError(detail, status, code, problem),
      })
    }

    xhr.onerror = () => {
      opts.signal?.removeEventListener("abort", onAbort)
      resolve({
        ok: false,
        error: makeUploadError(
          "Network error during upload.",
          undefined,
          "UPLOAD_NETWORK_ERROR",
        ),
      })
    }

    xhr.ontimeout = () => {
      opts.signal?.removeEventListener("abort", onAbort)
      resolve({
        ok: false,
        error: makeUploadError(
          "Upload timed out. Try again.",
          undefined,
          "UPLOAD_NETWORK_TIMEOUT",
        ),
      })
    }

    xhr.onabort = () => {
      opts.signal?.removeEventListener("abort", onAbort)
      resolve({
        ok: false,
        error: makeUploadError("Upload aborted", undefined, "UPLOAD_ABORTED"),
      })
    }

    xhr.send(opts.formData)
  })
}

function deriveDefaultCode(status: number): string {
  if (status === 401) return "UPLOAD_AUTH_EXPIRED"
  if (status === 403) return "UPLOAD_FORBIDDEN"
  if (status === 413) return "UPLOAD_TOO_LARGE"
  if (status === 415) return "UPLOAD_TYPE_NOT_ALLOWED"
  if (status === 408 || status === 504) return "UPLOAD_NETWORK_TIMEOUT"
  if (status >= 500) return "UPLOAD_SERVER_ERROR"
  return "UPLOAD_FAILED"
}

/**
 * Send a multipart upload with progress reporting, exponential-backoff
 * retry on transient failures, and a single auto-retry after a 401
 * (which silently refreshes the access token before re-sending). The
 * promise resolves with the parsed JSON response on success or rejects
 * with an `UploadError` carrying { status, code, details } so callers
 * can map specific failures to user-facing messages.
 */
export async function uploadWithProgress<T = unknown>(
  options: UploadOptions,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  let lastError: UploadError | null = null
  let triedReAuth = false

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw makeUploadError("Upload aborted", undefined, "UPLOAD_ABORTED")
    }

    const result = await sendOnce<T>(options)
    if (result.ok) {
      return result.data
    }
    lastError = result.error

    // 401 → try one silent refresh + retry without consuming the
    // exponential-backoff budget.
    if (result.error.status === 401 && !triedReAuth) {
      triedReAuth = true
      const refreshed = await refreshSession()
      if (refreshed) {
        attempt -= 1 // re-attempt without consuming the budget
        continue
      }
      throw result.error
    }

    // Don't retry validation/auth errors — they will fail the same way.
    const status = result.error.status
    if (status !== undefined && status < 500 && status !== 408 && status !== 425 && status !== 429) {
      throw result.error
    }
    if (!isTransientStatus(status)) {
      throw result.error
    }

    if (attempt >= maxAttempts) {
      throw result.error
    }

    const wait = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]
    options.onRetry?.(attempt + 1, result.error.message)
    await delay(wait, options.signal)
  }

  throw lastError ?? makeUploadError("Upload failed", undefined, "UPLOAD_FAILED")
}
