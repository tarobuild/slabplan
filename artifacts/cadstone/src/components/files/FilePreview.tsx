import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { inferPreviewKind } from "./file-preview-kind"

// PDFs stay in the browser's native viewer. Customer PDFs have repeatedly
// exposed pdf.js edge cases and high memory use, so the app preview never
// mounts the in-app PDF renderer.

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

function buildAuthFetchUrl(file: PreviewFile): string | null {
  if (file.viewUrl && !isInlineDirectUrl(file.viewUrl)) return file.viewUrl
  const id = file.fileId || file.id
  if (id) return `/files/${id}/view`
  // If the only thing we have is a non-inline directUrl (e.g. a relative or
  // absolute URL pointing at a protected file), route it through the
  // authenticated API client rather than a raw browser fetch.
  if (file.directUrl && !isInlineDirectUrl(file.directUrl)) return file.directUrl
  return null
}

function inlineDirectUrl(file: PreviewFile): string | null {
  return isInlineDirectUrl(file.directUrl) ? file.directUrl ?? null : null
}

export async function readInlineTextUrl(url: string): Promise<string> {
  const response = await fetch(url)
  return response.text()
}

type SignedFileUrlResponse = {
  url: string
  expiresAt?: string
  expiresIn?: number
}

async function mintSignedViewUrl(fileId: string): Promise<string> {
  const res = await api.post<SignedFileUrlResponse>(`/files/${fileId}/signed-view`)
  if (!res.data.url) throw new Error("Missing signed view URL")
  return res.data.url
}

async function mintSignedDownloadUrl(fileId: string): Promise<string> {
  const res = await api.post<SignedFileUrlResponse>(`/files/${fileId}/signed-download`)
  if (!res.data.url) throw new Error("Missing signed download URL")
  return res.data.url
}

function openLoadingPreviewTab(): Window | null {
  const newWindow = window.open("about:blank", "_blank")
  if (!newWindow) {
    toast.error("Please allow pop-ups to open this file.")
    return null
  }

  try {
    newWindow.document.write(
      '<!DOCTYPE html><title>Loading…</title>' +
        '<body style="margin:0;display:flex;align-items:center;justify-content:center;' +
        'height:100vh;font-family:sans-serif;color:#cbd5e1;background:#0f172a;">Loading…</body>',
    )
    newWindow.opener = null
  } catch {
    // Keep the file-open path working even if a browser extension blocks writes.
  }

  return newWindow
}

async function downloadPreviewFile(file: PreviewFile) {
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

  const fileId = file.fileId || file.id || null
  if (fileId) {
    const progressToast = toast.loading("Preparing download…")
    try {
      const signedUrl = await mintSignedDownloadUrl(fileId)
      toast.dismiss(progressToast)
      window.location.assign(signedUrl)
    } catch (error) {
      toast.dismiss(progressToast)
      throw error
    }
    return
  }

  const url = buildAuthFetchUrl(file)
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
}

async function openPreviewFileInNewTab(file: PreviewFile) {
  const inline = inlineDirectUrl(file)
  if (inline) {
    const w = window.open(inline, "_blank", "noopener")
    if (!w) toast.error("Please allow pop-ups to open this file.")
    return
  }

  const fileId = file.fileId || file.id || null
  if (!fileId) {
    toast.error("This file can't be opened in a new tab.")
    return
  }

  const newWindow = openLoadingPreviewTab()
  if (!newWindow) return

  try {
    const signedUrl = await mintSignedViewUrl(fileId)
    newWindow.location.replace(signedUrl)
  } catch (err) {
    try {
      newWindow.close()
    } catch {
      // ignore
    }
    throw err
  }
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
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950/90 backdrop-blur-sm">
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

  const handleDownload = async () => {
    try {
      await downloadPreviewFile(file)
    } catch (err: unknown) {
      toastApiError(err, "Failed to download file.")
    }
  }

  const handleOpenInNewTab = async () => {
    try {
      await openPreviewFileInNewTab(file)
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
  const kind = useMemo(() => inferPreviewKind(file.mimeType, file.name), [file.mimeType, file.name])

  // Inline direct URL (data:/blob:) gets used as-is; otherwise non-PDF previews
  // fetch through the auth'd API client and turn the response into a blob URL.
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

    if (kind === "pdf") {
      setBlobUrl(directUrl)
      setLoading(false)
    } else if (directUrl) {
      if (kind === "text") {
        setLoading(true)
        setBlobUrl(null)
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

  if (kind === "pdf") {
    return <PdfExternalView file={file} />
  }

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

function PdfExternalView({ file }: { file: PreviewFile }) {
  const handleOpen = async () => {
    try {
      await openPreviewFileInNewTab(file)
    } catch (err: unknown) {
      toastApiError(err, "Failed to open PDF.")
    }
  }

  const handleDownload = async () => {
    try {
      await downloadPreviewFile(file)
    } catch (err: unknown) {
      toastApiError(err, "Failed to download PDF.")
    }
  }

  return (
    <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center text-white">
      <FileText className="size-14 text-white/40" />
      <div>
        <p className="text-sm font-semibold">Open this PDF in your browser</p>
        <p className="mt-1 text-xs text-white/60">
          This keeps large PDFs out of the app preview.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={handleOpen}
          className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
        >
          <ExternalLink className="size-4" />
          Open PDF
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
        >
          <Download className="size-4" />
          Download
        </button>
      </div>
    </div>
  )
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
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden p-4">
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
        className="max-h-[calc(100vh-132px)] max-w-full select-none rounded-sm bg-white object-contain shadow-2xl ring-1 ring-white/10"
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
  const handleDownload = async () => {
    try {
      await downloadPreviewFile(file)
    } catch (err: unknown) {
      toastApiError(err, "Failed to download file.")
    }
  }

  const handleOpenInNewTab = async () => {
    try {
      await openPreviewFileInNewTab(file)
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
