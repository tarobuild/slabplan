import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { toastApiError } from "@/lib/api-errors"

// PdfViewer (which pulls in react-pdf + pdfjs-dist, ~500 KB) is loaded on
// demand the first time a user previews a PDF. Keeping it out of the
// eager bundle shaves the same ~500 KB off the dashboard's first paint
// for the vast majority of sessions that never open a PDF.
const PdfViewer = lazy(() => import("./PdfViewer"))

export type PreviewFile = {
  // One of: a server file id (preferred — used to fetch via the auth'd API),
  // or an inline `directUrl` (for data: URLs, e.g. comment attachments
  // historically stored as data URLs).
  id?: string | null
  fileId?: string | null
  // Optional pre-built absolute or relative URL the API client can fetch from.
  // If both `fileId`/`id` and `viewUrl` are provided, `viewUrl` wins. Should
  // be prefixed with /folders/.../files/.../view or /files/:id/view.
  viewUrl?: string | null
  // For data URLs / blob URLs that should be used directly without any fetch.
  directUrl?: string | null

  name: string
  mimeType?: string | null
  fileSize?: number | null
  uploadedByName?: string | null
  createdAt?: string | null
}

type PreviewKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "unsupported"

function inferKind(mime: string | null | undefined, name: string): PreviewKind {
  const m = (mime || "").toLowerCase()
  if (m.startsWith("image/")) return "image"
  if (m.startsWith("video/")) return "video"
  if (m.startsWith("audio/")) return "audio"
  if (m === "application/pdf") return "pdf"
  if (
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/xml" ||
    m === "application/javascript" ||
    m === "application/x-yaml"
  ) {
    return "text"
  }

  // Fall back to extension sniffing for cases where the server didn't set a
  // useful mime type.
  const lower = name.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|svg|heic|bmp|tiff?)$/.test(lower)) return "image"
  if (/\.(mp4|mov|webm|m4v|avi|mkv)$/.test(lower)) return "video"
  if (/\.(mp3|wav|m4a|ogg|flac|aac)$/.test(lower)) return "audio"
  if (/\.pdf$/.test(lower)) return "pdf"
  if (/\.(txt|md|markdown|json|xml|yml|yaml|csv|log|js|jsx|ts|tsx|css|html?)$/.test(lower)) {
    return "text"
  }

  return "unsupported"
}

function formatFileSize(bytes: number | null | undefined) {
  if (bytes == null) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(d: string | null | undefined) {
  if (!d) return null
  try {
    return new Date(d).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return d
  }
}

function isInlineDirectUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return url.startsWith("data:") || url.startsWith("blob:")
}

function safeApiFileUrl(url: string | null | undefined): string | null {
  if (!url || isInlineDirectUrl(url)) return null
  if (!url.startsWith("/")) return null
  if (url.startsWith("//")) return null
  if (/^\/(?:files\/[^/]+|folders\/[^/]+\/files\/[^/]+)\/(?:view|download)(?:\?.*)?$/.test(url)) {
    return url
  }
  return null
}

function buildAuthFetchUrl(file: PreviewFile): string | null {
  const viewUrl = safeApiFileUrl(file.viewUrl)
  if (viewUrl) return viewUrl
  const id = file.fileId || file.id
  if (id) return `/files/${id}/view`
  const directUrl = safeApiFileUrl(file.directUrl)
  if (directUrl) return directUrl
  return null
}

function inlineDirectUrl(file: PreviewFile): string | null {
  return isInlineDirectUrl(file.directUrl) ? file.directUrl ?? null : null
}

export async function readInlineTextUrl(url: string): Promise<string> {
  const response = await fetch(url)
  return response.text()
}

type FilePreviewProps = {
  files: PreviewFile[]
  initialIndex?: number
  open: boolean
  onClose: () => void
}

export function clampFilePreviewIndex(index: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(Math.max(index, 0), total - 1)
}

export function FilePreview({ files, initialIndex = 0, open, onClose }: FilePreviewProps) {
  const [index, setIndex] = useState(() =>
    clampFilePreviewIndex(initialIndex, files.length),
  )

  useEffect(() => {
    if (open) setIndex(clampFilePreviewIndex(initialIndex, files.length))
  }, [open, initialIndex, files.length])

  const safeIndex = clampFilePreviewIndex(index, files.length)
  const current = files[safeIndex]
  const total = files.length
  const hasMultiple = total > 1

  const goPrev = useCallback(() => {
    if (!hasMultiple) return
    setIndex((safeIndex - 1 + total) % total)
  }, [hasMultiple, safeIndex, total])

  const goNext = useCallback(() => {
    if (!hasMultiple) return
    setIndex((safeIndex + 1) % total)
  }, [hasMultiple, safeIndex, total])

  // Keyboard shortcuts.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        goPrev()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose, goPrev, goNext])

  if (!open || !current) return null

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-900/95 backdrop-blur-sm">
      <PreviewHeader
        file={current}
        index={safeIndex}
        total={total}
        onClose={onClose}
      />

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous file"
              className="absolute left-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 sm:left-4"
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Next file"
              className="absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 sm:right-4"
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        )}

        <PreviewBody key={`${safeIndex}-${current.id || current.fileId || current.directUrl || current.name}`} file={current} />
      </div>
    </div>
  )
}

function PreviewHeader({
  file,
  index,
  total,
  onClose,
}: {
  file: PreviewFile
  index: number
  total: number
  onClose: () => void
}) {
  const meta = [
    formatFileSize(file.fileSize),
    file.uploadedByName,
    formatDate(file.createdAt),
  ]
    .filter(Boolean)
    .join(" • ")

  const fileId = file.fileId || file.id || null

  const handleDownload = async () => {
    try {
      // Inline direct URL (data:/blob:) — just trigger an <a download>.
      const inline = inlineDirectUrl(file)
      if (inline) {
        const a = document.createElement("a")
        a.href = inline
        a.download = file.name || "download"
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        return
      }

      // Prefer the dedicated download route when a file id is available, since
      // it sets the right Content-Disposition and original filename.
      const url = fileId ? `/files/${fileId}/download` : buildAuthFetchUrl(file)
      if (!url) {
        toast.error("This file isn't available to download.")
        return
      }
      const res = await api.get<Blob>(url, { responseType: "blob" })
      const objectUrl = URL.createObjectURL(res.data)
      const a = document.createElement("a")
      a.href = objectUrl
      a.download = file.name || "download"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (err: unknown) {
      toastApiError(err, "Failed to download file.")
    }
  }

  const handleOpenInNewTab = async () => {
    try {
      // Inline data:/blob: URLs — open as-is.
      const inline = inlineDirectUrl(file)
      if (inline) {
        const w = window.open(inline, "_blank", "noopener")
        if (!w) toast.error("Please allow pop-ups to open this file.")
        return
      }

      if (!fileId) {
        toast.error("This file can't be opened in a new tab.")
        return
      }

      // Ask the server for a short-lived signed URL we can hand to a fresh
      // browser tab. This works without a Bearer token in the new tab.
      const res = await api.post<{ url: string }>(`/files/${fileId}/signed-view`)
      const signedUrl = res.data.url
      const w = window.open(signedUrl, "_blank", "noopener")
      if (!w) toast.error("Please allow pop-ups to open this file.")
    } catch (err: unknown) {
      toastApiError(err, "Failed to open file in a new tab.")
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-white/10 bg-slate-950/80 px-4 py-3 text-white">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" title={file.name}>
          {file.name}
        </p>
        {meta ? <p className="mt-0.5 truncate text-xs text-white/60">{meta}</p> : null}
      </div>

      {total > 1 && (
        <span className="hidden shrink-0 text-xs tabular-nums text-white/60 sm:inline">
          {index + 1} of {total}
        </span>
      )}

      <button
        type="button"
        onClick={handleDownload}
        title="Download"
        className="rounded-md p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white"
      >
        <Download className="size-4" />
      </button>
      <button
        type="button"
        onClick={handleOpenInNewTab}
        title="Open in new tab"
        className="rounded-md p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white"
      >
        <ExternalLink className="size-4" />
      </button>
      <button
        type="button"
        onClick={onClose}
        title="Close"
        className="rounded-md p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

function PreviewBody({ file }: { file: PreviewFile }) {
  const kind = useMemo(() => inferKind(file.mimeType, file.name), [file.mimeType, file.name])

  // Inline direct URL (data:/blob:) gets used as-is; otherwise fetch via the
  // auth'd API client and turn the response into a blob URL.
  const fetchUrl = buildAuthFetchUrl(file)
  const directUrl = inlineDirectUrl(file)

  const [blobUrl, setBlobUrl] = useState<string | null>(directUrl)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let createdBlobUrl: string | null = null

    setError(null)
    setTextContent(null)

    if (directUrl) {
      if (kind === "text") {
        setBlobUrl(null)
        setLoading(true)
        readInlineTextUrl(directUrl)
          .then((text) => {
            if (!cancelled) setTextContent(text)
          })
          .catch(() => {
            if (!cancelled) setError("Failed to load file.")
          })
          .finally(() => {
            if (!cancelled) setLoading(false)
          })
      } else {
        setBlobUrl(directUrl)
        setLoading(false)
      }
    } else if (fetchUrl) {
      setLoading(true)
      setBlobUrl(null)
      api
        .get<Blob>(fetchUrl, { responseType: "blob" })
        .then(async (res) => {
          if (cancelled) return
          if (kind === "text") {
            const text = await res.data.text()
            if (!cancelled) setTextContent(text)
          } else {
            const url = URL.createObjectURL(res.data)
            createdBlobUrl = url
            if (!cancelled) setBlobUrl(url)
          }
        })
        .catch(() => {
          if (!cancelled) setError("Failed to load file.")
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    } else {
      setError("This file isn't available to preview.")
    }

    return () => {
      cancelled = true
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl)
    }
  }, [fetchUrl, directUrl, kind])

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-white/60" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-6 text-center text-sm text-white/70">{error}</div>
    )
  }

  if (kind === "image" && blobUrl) {
    return <ImageViewer src={blobUrl} alt={file.name} />
  }

  if (kind === "video" && blobUrl) {
    return (
      <video
        src={blobUrl}
        controls
        autoPlay
        preload="auto"
        className="max-h-[calc(100vh-100px)] max-w-full bg-black"
      />
    )
  }

  if (kind === "audio" && blobUrl) {
    return (
      <div className="flex w-full max-w-lg flex-col items-center gap-4 px-6 text-white">
        <FileText className="size-12 text-white/40" />
        <p className="text-sm font-medium">{file.name}</p>
        <audio src={blobUrl} controls className="w-full" />
      </div>
    )
  }

  if (kind === "pdf" && blobUrl) {
    return (
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="size-8 animate-spin text-white/60" />
          </div>
        }
      >
        <PdfViewer src={blobUrl} fileId={file.fileId || file.id || null} />
      </Suspense>
    )
  }

  if (kind === "text" && textContent !== null) {
    return (
      <div className="m-4 flex max-h-[calc(100vh-120px)] w-full max-w-4xl overflow-auto rounded-lg bg-white p-6 shadow-xl">
        <pre className="w-full whitespace-pre-wrap break-words text-xs text-slate-800">
          {textContent}
        </pre>
      </div>
    )
  }

  return <UnsupportedView file={file} />
}

function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  // Reset zoom when the image source changes.
  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [src])

  // Keyboard +/- to zoom.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault()
        setScale((s) => Math.min(s * 1.25, 8))
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault()
        setScale((s) => Math.max(s / 1.25, 0.25))
      } else if (e.key === "0") {
        e.preventDefault()
        setScale(1)
        setOffset({ x: 0, y: 0 })
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (scale <= 1) return
    e.preventDefault()
    ;(e.target as HTMLImageElement).setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setOffset({
      x: drag.baseX + (e.clientX - drag.startX),
      y: drag.baseY + (e.clientY - drag.startY),
    })
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <img
        src={src}
        alt={alt}
        draggable={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transition: dragRef.current ? "none" : "transform 0.15s ease",
          cursor: scale > 1 ? "grab" : "default",
          touchAction: scale > 1 ? "none" : "auto",
        }}
        className="max-h-[calc(100vh-100px)] max-w-full select-none object-contain"
      />

      <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-slate-950/80 px-2 py-1 text-white shadow-lg">
        <button
          type="button"
          onClick={() => setScale((s) => Math.max(s / 1.25, 0.25))}
          className="rounded-full p-1.5 hover:bg-white/10"
          title="Zoom out"
        >
          <Minus className="size-4" />
        </button>
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setScale((s) => Math.min(s * 1.25, 8))}
          className="rounded-full p-1.5 hover:bg-white/10"
          title="Zoom in"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setScale(1)
            setOffset({ x: 0, y: 0 })
          }}
          className="rounded-full p-1.5 hover:bg-white/10"
          title="Fit to screen"
        >
          <Maximize2 className="size-4" />
        </button>
      </div>
    </div>
  )
}

function UnsupportedView({ file }: { file: PreviewFile }) {
  const fileId = file.fileId || file.id || null

  const handleDownload = async () => {
    try {
      const inline = inlineDirectUrl(file)
      if (inline) {
        const a = document.createElement("a")
        a.href = inline
        a.download = file.name || "download"
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        return
      }
      const url = fileId ? `/files/${fileId}/download` : buildAuthFetchUrl(file)
      if (!url) return
      const res = await api.get<Blob>(url, { responseType: "blob" })
      const objectUrl = URL.createObjectURL(res.data)
      const a = document.createElement("a")
      a.href = objectUrl
      a.download = file.name || "download"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (err: unknown) {
      toastApiError(err, "Failed to download file.")
    }
  }

  const handleOpenInNewTab = async () => {
    try {
      const inline = inlineDirectUrl(file)
      if (inline) {
        window.open(inline, "_blank", "noopener")
        return
      }
      if (!fileId) return
      const res = await api.post<{ url: string }>(`/files/${fileId}/signed-view`)
      window.open(res.data.url, "_blank", "noopener")
    } catch (err: unknown) {
      toastApiError(err, "Failed to open file.")
    }
  }

  return (
    <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center text-white">
      <FileText className="size-14 text-white/40" />
      <div>
        <p className="text-sm font-semibold">No in-app preview for this file type</p>
        <p className="mt-1 text-xs text-white/60">
          You can still download it or open it in a new tab.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
        >
          <Download className="size-4" />
          Download
        </button>
        <button
          type="button"
          onClick={handleOpenInNewTab}
          className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
        >
          <ExternalLink className="size-4" />
          Open in new tab
        </button>
      </div>
    </div>
  )
}
