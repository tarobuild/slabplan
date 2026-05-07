import {
  DANGEROUS_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_COUNT,
  MAX_VIDEO_DURATION_SECONDS as SHARED_MAX_VIDEO_DURATION_SECONDS,
  WIDE_UPLOAD_ACCEPT_ATTRIBUTE,
  dangerousUploadMessage,
  formatUploadSize,
  formatVideoDuration as sharedFormatVideoDuration,
  videoDurationLimitLabel,
} from "@workspace/api-zod"

export type UploadMediaType = "document" | "photo" | "video" | "any"

// The size and count limits live in @workspace/api-zod so the file picker
// and the multer config on the server cannot drift apart. Keep the legacy
// names as re-exports so existing call sites don't churn.
export const UPLOAD_MAX_FILE_SIZE_BYTES = MAX_UPLOAD_FILE_BYTES
export const UPLOAD_MAX_FILES = MAX_UPLOAD_FILE_COUNT

// Max length of an uploaded video. Source of truth lives in
// @workspace/api-zod so the server-side ffprobe check and this client
// pre-flight cannot drift apart. Re-exported under the legacy name so
// existing call sites don't churn.
export const MAX_VIDEO_DURATION_SECONDS = SHARED_MAX_VIDEO_DURATION_SECONDS

// Used by `isVideoFile` below to decide which selected files need a
// duration probe. The picker no longer narrows by media type (we use
// the shared WIDE_UPLOAD_ACCEPT_ATTRIBUTE everywhere) so these lists
// only exist for the duration check.
const videoExtensions = [".mp4", ".mov", ".avi", ".webm", ".m4v"]
const videoMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-m4v",
])

function lowerExtension(fileName: string) {
  const index = fileName.lastIndexOf(".")
  return index >= 0 ? fileName.slice(index).toLowerCase() : ""
}

const formatMaxFileSize = formatUploadSize

/**
 * `accept` attribute for `<input type="file">`. We use the same wide
 * extension list everywhere — Files, Daily Logs, Daily Log comments,
 * Schedule attachments, Lead attachments, Job documents — so users can
 * always attach what they actually have on disk. The `mediaType`
 * argument is kept on the signature for backwards compatibility with
 * existing call sites (including the "any" media type added for mixed
 * pickers); folder organisation in the UI no longer narrows the picker.
 */
export function uploadAcceptForMediaType(_mediaType: UploadMediaType) {
  return WIDE_UPLOAD_ACCEPT_ATTRIBUTE
}

/** Hint surfaced near video upload pickers so users learn the cap before they pick. */
export function videoUploadHint() {
  return `Videos must be ${MAX_VIDEO_DURATION_SECONDS / 60} minutes or shorter.`
}

// Re-export the shared formatter so existing call sites keep working
// without each having to import from @workspace/api-zod directly.
export const formatVideoDuration = sharedFormatVideoDuration

/**
 * Front-end pre-flight gate. Mirrors the server's blocklist model: we
 * accept any file the user picked unless its extension is in the shared
 * dangerous-extension blocklist (executables, shell scripts, HTML/JS
 * that could run in a browser session). Size + count limits still apply.
 *
 * The server is the authoritative gate (magic-byte sniffer + blocklist),
 * so we deliberately do NOT block on generic MIMEs like
 * `application/octet-stream` or empty strings — Windows pickers report
 * those for legitimate files all the time and we used to dead-end users
 * because of it.
 */
export function validateSelectedFiles(
  files: File[],
  _mediaType: UploadMediaType,
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
    if (DANGEROUS_UPLOAD_EXTENSIONS.has(extension)) {
      return `${file.name}: ${dangerousUploadMessage(file.name)}`
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Async video-duration validator.
// ---------------------------------------------------------------------------
//
// Run this AFTER the synchronous `validateSelectedFiles` check passes —
// it short-circuits non-video selections and otherwise reads each
// video's duration via an off-DOM `<video>` element so we can reject
// clips longer than `MAX_VIDEO_DURATION_SECONDS` before the upload
// starts. If the browser cannot decode the metadata (corrupt header,
// exotic codec) we treat the duration as unknown and let the file
// through — the server's existing size + magic-byte checks remain the
// safety net.

type DurationProbe = (file: File) => Promise<number | null>

const DEFAULT_PROBE_TIMEOUT_MS = 8000

function defaultProbeDuration(file: File): Promise<number | null> {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    video.preload = "metadata"
    video.muted = true
    let settled = false

    const cleanup = () => {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
      video.removeAttribute("src")
      try {
        video.load()
      } catch {
        /* ignore */
      }
    }

    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    video.onloadedmetadata = () => {
      const duration = video.duration
      finish(Number.isFinite(duration) && duration > 0 ? duration : null)
    }
    video.onerror = () => finish(null)
    setTimeout(() => finish(null), DEFAULT_PROBE_TIMEOUT_MS)

    try {
      video.src = url
    } catch {
      finish(null)
    }
  })
}

function isVideoFile(file: File): boolean {
  const mime = file.type.toLowerCase()
  if (mime.startsWith("video/") || videoMimeTypes.has(mime)) return true
  return videoExtensions.includes(lowerExtension(file.name))
}

/**
 * Async companion to `validateSelectedFiles`. Returns the first
 * user-facing error message (or `null` if every video is acceptable /
 * has unreadable metadata). Callers should still run the synchronous
 * validator first; this helper assumes the file list has already
 * passed type/size/count checks.
 */
export async function validateVideoDurations(
  files: File[],
  options?: {
    maxDurationSeconds?: number
    probe?: DurationProbe
  },
): Promise<string | null> {
  const maxSeconds = options?.maxDurationSeconds ?? MAX_VIDEO_DURATION_SECONDS
  const probe = options?.probe ?? defaultProbeDuration

  for (const file of files) {
    if (!isVideoFile(file)) continue
    const duration = await probe(file)
    if (duration == null) continue // unreadable → fall through to server
    if (duration > maxSeconds) {
      const limit = videoDurationLimitLabel(maxSeconds)
      return `Videos must be ${limit} or shorter. ${file.name} is ${formatVideoDuration(duration)}.`
    }
  }

  return null
}

/**
 * Probe each selected file and return an array of (seconds | null) in
 * the same order. Non-video files and files where the browser cannot
 * decode metadata both yield null. Used at upload time so the server
 * can persist the duration once and the Files > Videos browser doesn't
 * have to re-decode every clip on every render (Task #368).
 */
export async function probeVideoDurations(
  files: File[],
  options?: { probe?: DurationProbe },
): Promise<Array<number | null>> {
  const probe = options?.probe ?? defaultProbeDuration
  const out: Array<number | null> = []
  for (const file of files) {
    if (!isVideoFile(file)) {
      out.push(null)
      continue
    }
    const duration = await probe(file)
    out.push(duration != null && Number.isFinite(duration) && duration > 0 ? duration : null)
  }
  return out
}

/**
 * Runs the synchronous `validateSelectedFiles` first and, if it
 * passes, runs `validateVideoDurations` on any video files in the
 * selection. Returns the first failing message or `null` if everything
 * is acceptable.
 *
 * The duration check fires regardless of `mediaType` so any picker —
 * the Files > Videos browser, the daily-logs attachment dropzone (now
 * mediaType `"any"`), or a future combined picker — gets the 2-minute
 * cap enforced for free the moment a video file is selected.
 */
export async function validateSelectedFilesAsync(
  files: File[],
  mediaType: UploadMediaType,
  options?: {
    maxFileSizeBytes?: number
    maxFiles?: number
    maxDurationSeconds?: number
    probeDuration?: DurationProbe
  },
): Promise<string | null> {
  const sync = validateSelectedFiles(files, mediaType, options)
  if (sync) return sync
  return validateVideoDurations(files, {
    maxDurationSeconds: options?.maxDurationSeconds,
    probe: options?.probeDuration,
  })
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
