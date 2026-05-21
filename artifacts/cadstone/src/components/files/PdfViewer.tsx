import { useEffect, useRef, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Minus,
  Pencil,
  Plus,
} from "lucide-react"
import { toast } from "sonner"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { PdfAnnotationLayer } from "./PdfAnnotationLayer"
import { PdfMarkupToolbar } from "./PdfMarkupToolbar"
import { usePdfAnnotations } from "./use-pdf-annotations"
import { useAuthStore } from "@/store/auth"

// Lazy-load the pdf.js worker so the bundle isn't bloated for users who
// never preview a PDF. This file itself is loaded via React.lazy() from
// FilePreview.tsx so all of pdfjs-dist + react-pdf only ship to clients
// that actually open a PDF (~500 KB savings on first paint).
let pdfWorkerConfigured = false
async function ensurePdfWorker() {
  if (pdfWorkerConfigured) return
  pdfWorkerConfigured = true
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
}

export default function PdfViewer({ src, fileId }: { src: string; fileId: string | null }) {
  const [scale, setScale] = useState(1)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [workerReady, setWorkerReady] = useState(false)
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null)
  const [markupMode, setMarkupMode] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const currentUser = useAuthStore((s) => s.user)
  const annotations = usePdfAnnotations({ fileId, enabled: !!fileId })

  useEffect(() => {
    let cancelled = false
    void ensurePdfWorker().then(() => {
      if (!cancelled) setWorkerReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Keyboard +/- zoom and undo/redo.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          (target as HTMLElement).isContentEditable)
      if (inEditable) return

      if (markupMode && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) {
          annotations.redo()
        } else {
          annotations.undo()
        }
        return
      }

      if (e.key === "+" || e.key === "=") {
        e.preventDefault()
        setScale((s) => Math.min(s * 1.25, 4))
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault()
        setScale((s) => Math.max(s / 1.25, 0.25))
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [markupMode, annotations])

  // Reset markup mode when the file changes.
  useEffect(() => {
    setMarkupMode(false)
  }, [fileId])

  if (!workerReady) {
    return <Loader2 className="size-8 animate-spin text-white/60" />
  }

  const visibleAnnotations = annotations.filterMine
    ? annotations.annotations.filter(
        (a) => a.createdBy === (currentUser?.id ?? null),
      )
    : annotations.annotations

  const isAdminUser = currentUser?.role === "admin"
  const annotationsAvailable = !!fileId

  return (
    <div className="flex h-full w-full flex-col items-stretch">
      {markupMode && annotationsAvailable ? (
        <PdfMarkupToolbar
          active={annotations.active}
          presets={annotations.presets}
          onSelectTool={annotations.setActive}
          onChangePreset={annotations.updatePreset}
          showMarkup={annotations.showMarkup}
          onToggleShowMarkup={annotations.setShowMarkup}
          filterMine={annotations.filterMine}
          onToggleFilterMine={annotations.setFilterMine}
          onUndo={annotations.undo}
          canUndo={annotations.canUndo}
          onRedo={annotations.redo}
          canRedo={annotations.canRedo}
          onExitMarkup={() => setMarkupMode(false)}
          totalAnnotations={annotations.annotations.length}
          visibleAnnotations={visibleAnnotations.length}
        />
      ) : null}

      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-slate-800 p-4"
      >
        <div className="mx-auto flex max-w-fit flex-col items-center gap-4">
          <Document
            file={src}
            onLoadSuccess={({ numPages: n }) => {
              setNumPages(n)
              if (pageNumber > n) setPageNumber(1)
            }}
            onLoadError={() => {
              toast.error("Failed to load PDF.")
            }}
            loading={<Loader2 className="size-8 animate-spin text-white/60" />}
          >
            <div className="relative">
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderAnnotationLayer={!markupMode}
                renderTextLayer={!markupMode}
                onRenderSuccess={(page) => {
                  setPageSize({ width: page.width, height: page.height })
                }}
                className="shadow-lg"
              />
              {pageSize && annotationsAvailable ? (
                <PdfAnnotationLayer
                  width={pageSize.width}
                  height={pageSize.height}
                  page={pageNumber}
                  annotations={visibleAnnotations}
                  drafts={annotations.drafts}
                  enabled={markupMode}
                  showMarkup={annotations.showMarkup}
                  preset={annotations.presetForActive}
                  activeTool={annotations.active}
                  currentUserId={currentUser?.id ?? null}
                  isAdmin={isAdminUser}
                  onCreate={annotations.createAnnotation}
                  onDelete={(id) => void annotations.deleteAnnotation(id)}
                  onUpdate={(id, patch) => annotations.updateAnnotation(id, patch)}
                />
              ) : null}
            </div>
          </Document>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 border-t border-white/10 bg-slate-950/80 px-4 py-2 text-white">
        <button
          type="button"
          onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
          disabled={pageNumber <= 1}
          className="rounded-md p-1.5 text-white/80 hover:bg-white/10 disabled:opacity-30"
          title="Previous page"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-[5.5rem] text-center text-xs tabular-nums text-white/80">
          Page {pageNumber} of {numPages ?? "—"}
        </span>
        <button
          type="button"
          onClick={() => setPageNumber((p) => (numPages ? Math.min(numPages, p + 1) : p))}
          disabled={!numPages || pageNumber >= numPages}
          className="rounded-md p-1.5 text-white/80 hover:bg-white/10 disabled:opacity-30"
          title="Next page"
        >
          <ChevronRight className="size-4" />
        </button>
        <span className="mx-2 h-4 w-px bg-white/20" />
        <button
          type="button"
          onClick={() => setScale((s) => Math.max(s / 1.25, 0.25))}
          className="rounded-md p-1.5 text-white/80 hover:bg-white/10"
          title="Zoom out"
        >
          <Minus className="size-4" />
        </button>
        <span className="min-w-[3rem] text-center text-xs tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setScale((s) => Math.min(s * 1.25, 4))}
          className="rounded-md p-1.5 text-white/80 hover:bg-white/10"
          title="Zoom in"
        >
          <Plus className="size-4" />
        </button>

        {annotationsAvailable ? (
          <>
            <span className="mx-2 h-4 w-px bg-white/20" />
            <button
              type="button"
              onClick={() => setMarkupMode((value) => !value)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
                markupMode
                  ? "bg-primary text-white shadow"
                  : "text-white/80 hover:bg-white/10"
              }`}
              title={markupMode ? "Exit markup mode" : "Enter markup mode"}
            >
              <Pencil className="size-3.5" />
              {markupMode ? "Markup" : "Markup"}
              {!markupMode && annotations.annotations.length > 0 ? (
                <span className="ml-1 rounded-full bg-white/15 px-1.5 text-[10px]">
                  {annotations.annotations.length}
                </span>
              ) : null}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
