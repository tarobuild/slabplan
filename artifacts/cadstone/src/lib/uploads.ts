import {
  DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES,
  DANGEROUS_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_COUNT,
  MAX_VIDEO_DURATION_SECONDS as SHARED_MAX_VIDEO_DURATION_SECONDS,
  VIDEO_UPLOAD_EXTENSIONS,
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

// Shared video-duration policy. Production is unlimited; a caller can still
// supply a finite route-specific override. Re-exported under the legacy name
// so existing call sites don't churn.
export const MAX_VIDEO_DURATION_SECONDS = SHARED_MAX_VIDEO_DURATION_SECONDS

// Used by `isVideoFile` below to decide which selected files need a
// duration probe. The picker no longer narrows by media type (we use
// the shared WIDE_UPLOAD_ACCEPT_ATTRIBUTE everywhere) so these lists
// only exist for the duration check.
const videoExtensions = VIDEO_UPLOAD_EXTENSIONS
const videoMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-m4v",
  "video/x-matroska",
  "video/x-ms-wmv",
  "video/x-flv",
  "video/3gpp",
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
  return "Large videos are supported. Uploads resume automatically if the connection drops."
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
// video's duration via an off-DOM `<video>` element for display metadata and
// for any caller that supplies a finite route-specific policy. If the browser
// cannot decode the metadata (corrupt header,
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
 * mediaType `"any"`), or a future combined picker — gets the same shared
 * policy the moment a video file is selected.
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
  /** Request timeout in milliseconds (default 10 minutes). */
  timeoutMs?: number
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
export const DEFAULT_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000
export const DEFAULT_CHUNKED_UPLOAD_CHUNK_SIZE_BYTES = 16 * 1024 * 1024
export { DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES }

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

function isPlainForbiddenUploadError(error: unknown): error is UploadError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as UploadError).status === 403 &&
    (error as UploadError).code === "UPLOAD_FORBIDDEN_PLAIN_RESPONSE"
  )
}

async function blobToBase64Body(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  const batchSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += batchSize) {
    const slice = bytes.subarray(offset, offset + batchSize)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
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
    xhr.timeout = opts.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS

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

      resolve({
        ok: false,
        error: buildUploadErrorFromResponse(
          status,
          parsed,
          typeof xhr.getResponseHeader === "function" ? xhr.getResponseHeader("Content-Type") : null,
        ),
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

async function authedJsonRequest<T>(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  let triedReAuth = false

  for (;;) {
    const token = useAuthStore.getState().accessToken
    const headers = new Headers(init.headers)
    headers.set("X-Requested-With", "XMLHttpRequest")
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json")
    }
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }

    const response = await fetch(`/api${url}`, {
      ...init,
      headers,
      credentials: "include",
      signal,
    })

    if (response.status === 401 && !triedReAuth) {
      triedReAuth = true
      const refreshed = await refreshSession()
      if (refreshed) continue
    }

    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (response.ok) {
      return parsed as T
    }

    throw buildUploadErrorFromResponse(response.status, parsed, response.headers.get("Content-Type"))
  }
}

function sendRawChunkOnce<T>(opts: {
  url: string
  blob: Blob
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (progress: UploadProgress) => void
}): Promise<XhrAttemptResult<T> | XhrAttemptError> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    const token = useAuthStore.getState().accessToken

    xhr.open("PUT", `/api${opts.url}`, true)
    xhr.withCredentials = true
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest")
    xhr.setRequestHeader("Content-Type", "application/octet-stream")
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`)
    }
    xhr.responseType = "text"
    xhr.timeout = opts.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !opts.onProgress) return
      opts.onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      })
    })

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

      resolve({
        ok: false,
        error: buildUploadErrorFromResponse(
          status,
          parsed,
          typeof xhr.getResponseHeader === "function" ? xhr.getResponseHeader("Content-Type") : null,
        ),
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

    xhr.send(opts.blob)
  })
}

function sendBase64ChunkOnce<T>(opts: {
  url: string
  body: string
  decodedSize: number
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (progress: UploadProgress) => void
}): Promise<XhrAttemptResult<T> | XhrAttemptError> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    const token = useAuthStore.getState().accessToken

    xhr.open("PUT", `/api${opts.url}`, true)
    xhr.withCredentials = true
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest")
    xhr.setRequestHeader("Content-Type", "text/plain")
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`)
    }
    xhr.responseType = "text"
    xhr.timeout = opts.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !opts.onProgress) return
      const encodedPercent = event.total > 0 ? event.loaded / event.total : 0
      const loaded = Math.min(opts.decodedSize, Math.round(opts.decodedSize * encodedPercent))
      opts.onProgress({
        loaded,
        total: opts.decodedSize,
        percent: Math.round((loaded / opts.decodedSize) * 100),
      })
    })

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

      resolve({
        ok: false,
        error: buildUploadErrorFromResponse(
          status,
          parsed,
          typeof xhr.getResponseHeader === "function" ? xhr.getResponseHeader("Content-Type") : null,
        ),
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

    xhr.send(opts.body)
  })
}

async function sendRawChunkWithRetry<T>(options: {
  url: string
  blob: Blob
  signal?: AbortSignal
  timeoutMs?: number
  maxAttempts?: number
  onProgress?: (progress: UploadProgress) => void
  onRetry?: (attempt: number, reason: string) => void
}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  let triedReAuth = false

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw makeUploadError("Upload aborted", undefined, "UPLOAD_ABORTED")
    }

    const result = await sendRawChunkOnce<T>(options)
    if (result.ok) return result.data

    if (result.error.status === 401 && !triedReAuth) {
      triedReAuth = true
      const refreshed = await refreshSession()
      if (refreshed) {
        attempt -= 1
        continue
      }
      throw result.error
    }

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

  throw makeUploadError("Upload failed", undefined, "UPLOAD_FAILED")
}

async function sendBase64ChunkWithRetry<T>(options: {
  url: string
  body: string
  decodedSize: number
  signal?: AbortSignal
  timeoutMs?: number
  maxAttempts?: number
  onProgress?: (progress: UploadProgress) => void
  onRetry?: (attempt: number, reason: string) => void
}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  let triedReAuth = false

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw makeUploadError("Upload aborted", undefined, "UPLOAD_ABORTED")
    }

    const result = await sendBase64ChunkOnce<T>(options)
    if (result.ok) return result.data

    if (result.error.status === 401 && !triedReAuth) {
      triedReAuth = true
      const refreshed = await refreshSession()
      if (refreshed) {
        attempt -= 1
        continue
      }
      throw result.error
    }

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

  throw makeUploadError("Upload failed", undefined, "UPLOAD_FAILED")
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

function buildUploadErrorFromResponse(
  status: number,
  parsed: unknown,
  responseContentType: string | null,
): UploadError {
  const problem = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  const detail =
    (problem?.detail as string | undefined) ||
    (problem?.message as string | undefined) ||
    `Upload failed with status ${status}.`
  const errors = problem?.errors as Record<string, unknown> | undefined
  const code =
    (errors?.code as string | undefined) ||
    (status === 403 && !problem ? "UPLOAD_FORBIDDEN_PLAIN_RESPONSE" : deriveDefaultCode(status))
  const rawBody = typeof parsed === "string" ? parsed.slice(0, 1000) : undefined

  return makeUploadError(
    detail,
    status,
    code,
    problem ?? {
      structured: false,
      responseContentType,
      rawBody,
    },
  )
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

async function uploadFileWithChunksToBaseUrl<T = unknown>(options: {
  baseUrl: string
  file: File
  startBody?: Record<string, unknown>
  chunkSizeBytes?: number
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (progress: UploadProgress) => void
  onRetry?: (attempt: number, reason: string) => void
}): Promise<T> {
  const chunkSizeBytes = options.chunkSizeBytes ?? DEFAULT_CHUNKED_UPLOAD_CHUNK_SIZE_BYTES
  const totalChunks = Math.max(1, Math.ceil(options.file.size / chunkSizeBytes))

  const start = await authedJsonRequest<{
    session: { uploadId: string }
  }>(
    options.baseUrl,
    {
      method: "POST",
      body: JSON.stringify({
        originalName: options.file.name,
        mimeType: options.file.type || "application/octet-stream",
        totalSize: options.file.size,
        totalChunks,
        ...(options.startBody ?? {}),
      }),
    },
    options.signal,
  )

  const uploadId = start.session.uploadId
  let completedBytes = 0

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const startByte = chunkIndex * chunkSizeBytes
    const endByte = Math.min(options.file.size, startByte + chunkSizeBytes)
    const blob = options.file.slice(startByte, endByte)

    const reportChunkProgress = (progress: UploadProgress) => {
      const loaded = Math.min(options.file.size, completedBytes + progress.loaded)
      options.onProgress?.({
        loaded,
        total: options.file.size,
        percent: Math.round((loaded / options.file.size) * 100),
      })
    }
    const chunkUrl = `${options.baseUrl}/${uploadId}/chunks/${chunkIndex}`

    try {
      await sendRawChunkWithRetry({
        url: chunkUrl,
        blob,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        onRetry: options.onRetry,
        onProgress: reportChunkProgress,
      })
    } catch (error) {
      if (!isPlainForbiddenUploadError(error)) {
        throw error
      }

      options.onRetry?.(1, "Retrying chunk with base64 transport after plain 403.")
      await sendBase64ChunkWithRetry({
        url: chunkUrl,
        body: await blobToBase64Body(blob),
        decodedSize: blob.size,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        onRetry: options.onRetry,
        onProgress: reportChunkProgress,
      })
    }

    completedBytes = endByte
    options.onProgress?.({
      loaded: completedBytes,
      total: options.file.size,
      percent: Math.round((completedBytes / options.file.size) * 100),
    })
  }

  return authedJsonRequest<T>(
    `${options.baseUrl}/${uploadId}/complete`,
    { method: "POST" },
    options.signal,
  )
}

type DirectUploadPreparation = {
  status: "ready"
  intentToken: string
  storage: {
    endpoint: string
    bucketName: string
    objectName: string
    signature: string
    chunkSizeBytes: number
    signatureExpiresInSeconds: number
    uploadUrlExpiresInSeconds: number
  }
}

type CachedDirectUpload = {
  intentToken: string
  cachedAt: number
}

const DIRECT_UPLOAD_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
// A signed provider authorization lasts about two hours while the durable
// intent lasts seven days. Keep enough refresh budget for the entire intent
// window (including clock/network jitter); the progress gate below still
// prevents a no-progress authorization loop.
const MAX_DIRECT_UPLOAD_SESSION_REFRESHES = 96

function directUploadResumeKey(baseUrl: string, file: File) {
  return [
    "cadstone-direct-upload-v1",
    baseUrl,
    file.name,
    file.size,
    file.type,
    file.lastModified,
  ].join("::")
}

function readCachedDirectUpload(key: string): CachedDirectUpload | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedDirectUpload>
    if (
      typeof parsed.intentToken !== "string" ||
      typeof parsed.cachedAt !== "number" ||
      Date.now() - parsed.cachedAt >= DIRECT_UPLOAD_CACHE_TTL_MS
    ) {
      window.localStorage.removeItem(key)
      return null
    }
    return { intentToken: parsed.intentToken, cachedAt: parsed.cachedAt }
  } catch {
    return null
  }
}

function writeCachedDirectUpload(key: string, intentToken: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ intentToken, cachedAt: Date.now() } satisfies CachedDirectUpload),
    )
  } catch {
    // Storage-disabled browsers still retain in-tab TUS retries.
  }
}

function clearCachedDirectUpload(key: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Best-effort cache cleanup only.
  }
}

function directUploadError(error: unknown): UploadError {
  if (error && typeof error === "object" && "originalResponse" in error) {
    const response = (
      error as {
        originalResponse?: {
          getStatus?: () => number
          getBody?: () => string
        }
      }
    ).originalResponse
    const status = response?.getStatus?.()
    const body = response?.getBody?.()
    const message =
      "message" in error && typeof error.message === "string"
        ? error.message
        : "Resumable upload failed."
    return makeUploadError(
      body || message,
      status,
      status ? deriveDefaultCode(status) : "UPLOAD_NETWORK_ERROR",
      error,
    )
  }
  return makeUploadError(
    error instanceof Error ? error.message : "Resumable upload failed.",
    undefined,
    "UPLOAD_NETWORK_ERROR",
    error,
  )
}

async function uploadFileDirectToStorage<T = unknown>(options: {
  baseUrl: string
  file: File
  startBody?: Record<string, unknown>
  signal?: AbortSignal
  onProgress?: (progress: UploadProgress) => void
  onRetry?: (attempt: number, reason: string) => void
}): Promise<T> {
  const resumeKey = directUploadResumeKey(options.baseUrl, options.file)
  let cached = readCachedDirectUpload(resumeKey)
  const complete = (intentToken: string) =>
    authedJsonRequest<T>(
      `${options.baseUrl}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ intentToken }),
      },
      options.signal,
    )

  if (cached) {
    try {
      const completed = await complete(cached.intentToken)
      clearCachedDirectUpload(resumeKey)
      return completed
    } catch (error) {
      const uploadError = error as UploadError
      if (
        uploadError.status === 401 ||
        uploadError.status === 403 ||
        uploadError.code === "DIRECT_UPLOAD_SCOPE_MISMATCH" ||
        uploadError.code === "DIRECT_UPLOAD_RESUME_MISMATCH"
      ) {
        clearCachedDirectUpload(resumeKey)
        cached = null
      } else if (
        uploadError.status !== 404 &&
        uploadError.code !== "DIRECT_UPLOAD_SIZE_MISMATCH"
      ) {
        if (uploadError.status === 415) clearCachedDirectUpload(resumeKey)
        throw error
      }
    }
  }

  const prepare = (resumeIntentToken?: string) =>
    authedJsonRequest<DirectUploadPreparation>(
      options.baseUrl,
      {
        method: "POST",
        body: JSON.stringify({
          originalName: options.file.name,
          mimeType: options.file.type || "application/octet-stream",
          totalSize: options.file.size,
          ...(options.startBody ?? {}),
          ...(resumeIntentToken ? { resumeIntentToken } : {}),
        }),
      },
      options.signal,
    )

  let prepared: DirectUploadPreparation
  try {
    prepared = await prepare(cached?.intentToken)
  } catch (error) {
    const uploadError = error as UploadError
    if (
      !cached ||
      (uploadError.status !== 401 &&
        uploadError.status !== 403 &&
        uploadError.code !== "DIRECT_UPLOAD_SCOPE_MISMATCH" &&
        uploadError.code !== "DIRECT_UPLOAD_RESUME_MISMATCH")
    ) {
      throw error
    }
    clearCachedDirectUpload(resumeKey)
    cached = null
    prepared = await prepare()
  }
  writeCachedDirectUpload(resumeKey, prepared.intentToken)

  const tus = await import("tus-js-client")
  let currentProgressBytes = 0
  let progressAtLastSessionRefresh = -1
  let sessionRefreshes = 0

  const runPreparedUpload = (current: DirectUploadPreparation) =>
    new Promise<void>((resolve, reject) => {
      let settled = false
      let upload: InstanceType<typeof tus.Upload> | null = null
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        options.signal?.removeEventListener("abort", onAbort)
        callback()
      }
      const onAbort = () => {
        void upload?.abort(false)
        finish(() => reject(makeUploadError("Upload aborted", undefined, "UPLOAD_ABORTED")))
      }

      upload = new tus.Upload(options.file, {
        endpoint: current.storage.endpoint,
        headers: { "x-signature": current.storage.signature },
        chunkSize: current.storage.chunkSizeBytes,
        retryDelays: [0, 1_000, 3_000, 5_000, 10_000, 20_000, 30_000],
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: current.storage.bucketName,
          objectName: current.storage.objectName,
          contentType: options.file.type || "application/octet-stream",
          cacheControl: "3600",
        },
        fingerprint: async () =>
          [
            "cadstone-direct-v1",
            current.storage.bucketName,
            current.storage.objectName,
            options.file.name,
            options.file.size,
            options.file.lastModified,
          ].join("::"),
        onShouldRetry: (error, retryAttempt) => {
          options.onRetry?.(retryAttempt + 1, error.message)
          const status = error.originalResponse?.getStatus()
          return (
            status === undefined ||
            status === 408 ||
            status === 409 ||
            status === 425 ||
            status === 429 ||
            status >= 500
          )
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          currentProgressBytes = bytesUploaded
          const total = bytesTotal || options.file.size
          options.onProgress?.({
            loaded: bytesUploaded,
            total,
            percent: total > 0 ? Math.round((bytesUploaded / total) * 100) : 100,
          })
        },
        onError: (error) => finish(() => reject(directUploadError(error))),
        onSuccess: () => finish(resolve),
      })

      if (options.signal?.aborted) {
        onAbort()
        return
      }
      options.signal?.addEventListener("abort", onAbort, { once: true })
      void upload
        .findPreviousUploads()
        .then((previous) => {
          if (settled) return
          if (previous.length > 0) upload?.resumeFromPreviousUpload(previous[0])
          upload?.start()
        })
        .catch((error) => finish(() => reject(directUploadError(error))))
    })

  for (;;) {
    try {
      await runPreparedUpload(prepared)
      break
    } catch (error) {
      const uploadError = error as UploadError
      const sessionCanBeRefreshed =
        uploadError.status === 401 ||
        uploadError.status === 403 ||
        uploadError.status === 404 ||
        uploadError.status === 410
      if (
        !sessionCanBeRefreshed ||
        options.signal?.aborted ||
        sessionRefreshes >= MAX_DIRECT_UPLOAD_SESSION_REFRESHES ||
        currentProgressBytes <= progressAtLastSessionRefresh
      ) {
        throw error
      }

      progressAtLastSessionRefresh = currentProgressBytes
      sessionRefreshes += 1
      options.onRetry?.(
        sessionRefreshes,
        "Refreshing secure resumable-upload authorization.",
      )
      prepared = await prepare(prepared.intentToken)
      writeCachedDirectUpload(resumeKey, prepared.intentToken)
    }
  }

  const completed = await complete(prepared.intentToken)
  clearCachedDirectUpload(resumeKey)
  return completed
}

export async function uploadFileWithChunks<T = unknown>(options: {
  folderId: string
  file: File
  note?: string | null
  duplicateAction?: "keep_both" | "skip_exact" | "fail_on_conflict"
  videoDurationSeconds?: number | null
  chunkSizeBytes?: number
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (progress: UploadProgress) => void
  onRetry?: (attempt: number, reason: string) => void
}): Promise<T> {
  const duplicateAction = options.duplicateAction ?? "keep_both"
  const startBody = {
    note: options.note?.trim() || undefined,
    duplicateAction,
    videoDurationSeconds: options.videoDurationSeconds ?? undefined,
  }
  // The direct route deliberately uses unique object keys and therefore only
  // implements keep-both semantics. Preserve the existing conflict/skip API
  // contract by keeping those uncommon explicit modes on the legacy route.
  if (duplicateAction !== "keep_both") {
    return uploadFileWithChunksToBaseUrl({
      ...options,
      baseUrl: `/folders/${options.folderId}/files/chunked`,
      startBody,
    })
  }
  try {
    return await uploadFileDirectToStorage({
      ...options,
      baseUrl: `/folders/${options.folderId}/files/direct`,
      startBody,
    })
  } catch (error) {
    if ((error as UploadError | null)?.code !== "DIRECT_UPLOAD_UNAVAILABLE") {
      throw error
    }
    return uploadFileWithChunksToBaseUrl({
      ...options,
      baseUrl: `/folders/${options.folderId}/files/chunked`,
      startBody,
    })
  }
}

export async function uploadLeadAttachmentWithChunks<T = unknown>(options: {
  leadId: string
  file: File
  chunkSizeBytes?: number
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (progress: UploadProgress) => void
  onRetry?: (attempt: number, reason: string) => void
}): Promise<T> {
  try {
    return await uploadFileDirectToStorage({
      ...options,
      baseUrl: `/leads/${options.leadId}/attachments/direct`,
    })
  } catch (error) {
    if ((error as UploadError | null)?.code !== "DIRECT_UPLOAD_UNAVAILABLE") {
      throw error
    }
    return uploadFileWithChunksToBaseUrl({
      ...options,
      baseUrl: `/leads/${options.leadId}/attachments/chunked`,
    })
  }
}
