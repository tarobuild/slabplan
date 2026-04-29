import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { StickyNote, X } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import type { Annotation, AnnotationToolType, DraftAnnotation, ToolPreset } from "./annotation-types"
import type { MarkupTool } from "./PdfMarkupToolbar"

const MOBILE_BREAKPOINT_PX = 640

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.innerWidth < MOBILE_BREAKPOINT_PX
  })
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`)
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile("matches" in e ? e.matches : false)
    }
    handler(mq)
    if (mq.addEventListener) {
      mq.addEventListener("change", handler as (e: MediaQueryListEvent) => void)
      return () =>
        mq.removeEventListener("change", handler as (e: MediaQueryListEvent) => void)
    }
    // Safari < 14 fallback
    mq.addListener(handler as (e: MediaQueryListEvent) => void)
    return () => mq.removeListener(handler as (e: MediaQueryListEvent) => void)
  }, [])
  return isMobile
}

type Point = [number, number]

type ActiveStroke = {
  tool: AnnotationToolType
  start: Point
  current: Point
  points: Point[]
  preset: ToolPreset
}

type PendingTextEditor = {
  tool: "sticky_note" | "text_label"
  x: number
  y: number
  preset: ToolPreset
}

type PdfAnnotationLayerProps = {
  width: number
  height: number
  page: number
  annotations: Annotation[]
  drafts: DraftAnnotation[]
  enabled: boolean
  showMarkup: boolean
  preset: ToolPreset
  activeTool: MarkupTool
  currentUserId: string | null
  isAdmin: boolean
  onCreate: (draft: Omit<DraftAnnotation, "tempId">) => void
  onDelete: (annotationId: string) => void
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function getRelativeCoords(
  event: ReactPointerEvent<SVGSVGElement>,
): Point | null {
  const target = event.currentTarget
  const rect = target.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height
  return [clamp01(x), clamp01(y)]
}

function pointsBoundingBox(points: Point[]): {
  x: number
  y: number
  w: number
  h: number
} {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = points[0][0]
  let minY = points[0][1]
  let maxX = points[0][0]
  let maxY = points[0][1]
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) }
}

function pointsToSvgPath(points: Point[], width: number, height: number): string {
  if (points.length === 0) return ""
  const [first, ...rest] = points
  const parts = [`M ${first[0] * width} ${first[1] * height}`]
  for (const [x, y] of rest) {
    parts.push(`L ${x * width} ${y * height}`)
  }
  return parts.join(" ")
}

function describeShape(
  tool: AnnotationToolType,
  start: Point,
  current: Point,
): { x: number; y: number; w: number; h: number } {
  void tool
  const x = Math.min(start[0], current[0])
  const y = Math.min(start[1], current[1])
  const w = Math.abs(current[0] - start[0])
  const h = Math.abs(current[1] - start[1])
  return { x, y, w, h }
}

function annotationCanBeDeletedBy(
  annotation: Annotation,
  currentUserId: string | null,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true
  if (!currentUserId) return false
  return annotation.createdBy === currentUserId
}

function renderAnnotationShape(
  a: Annotation | DraftAnnotation,
  width: number,
  height: number,
  isPending: boolean,
  onClick?: () => void,
) {
  const opacity = isPending ? a.opacity * 0.6 : a.opacity
  const cursor = onClick ? "pointer" : "default"

  switch (a.toolType) {
    case "highlighter":
    case "pen": {
      if (!a.pathData || a.pathData.length === 0) return null
      const d = pointsToSvgPath(a.pathData, width, height)
      return (
        <path
          d={d}
          stroke={a.color}
          strokeWidth={a.thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={opacity}
          onClick={onClick}
          style={{ cursor, pointerEvents: onClick ? "stroke" : "none" }}
        />
      )
    }
    case "line": {
      const x1 = a.normalizedX * width
      const y1 = a.normalizedY * height
      const x2 = (a.normalizedX + a.normalizedW) * width
      const y2 = (a.normalizedY + a.normalizedH) * height
      return (
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={a.color}
          strokeWidth={a.thickness}
          strokeLinecap="round"
          opacity={opacity}
          onClick={onClick}
          style={{ cursor, pointerEvents: onClick ? "stroke" : "none" }}
        />
      )
    }
    case "arrow": {
      const x1 = a.normalizedX * width
      const y1 = a.normalizedY * height
      const x2 = (a.normalizedX + a.normalizedW) * width
      const y2 = (a.normalizedY + a.normalizedH) * height
      const angle = Math.atan2(y2 - y1, x2 - x1)
      const headLength = Math.max(8, a.thickness * 4)
      const headAngle = Math.PI / 6
      const hx1 = x2 - headLength * Math.cos(angle - headAngle)
      const hy1 = y2 - headLength * Math.sin(angle - headAngle)
      const hx2 = x2 - headLength * Math.cos(angle + headAngle)
      const hy2 = y2 - headLength * Math.sin(angle + headAngle)
      return (
        <g
          opacity={opacity}
          onClick={onClick}
          style={{ cursor, pointerEvents: onClick ? "stroke" : "none" }}
        >
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={a.color}
            strokeWidth={a.thickness}
            strokeLinecap="round"
          />
          <polyline
            points={`${hx1},${hy1} ${x2},${y2} ${hx2},${hy2}`}
            stroke={a.color}
            strokeWidth={a.thickness}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>
      )
    }
    case "rectangle": {
      const x = a.normalizedX * width
      const y = a.normalizedY * height
      const w = a.normalizedW * width
      const h = a.normalizedH * height
      return (
        <rect
          x={x}
          y={y}
          width={Math.max(0, w)}
          height={Math.max(0, h)}
          stroke={a.color}
          strokeWidth={a.thickness}
          fill="none"
          opacity={opacity}
          onClick={onClick}
          style={{ cursor, pointerEvents: onClick ? "stroke" : "none" }}
        />
      )
    }
    case "ellipse": {
      const x = a.normalizedX * width
      const y = a.normalizedY * height
      const w = a.normalizedW * width
      const h = a.normalizedH * height
      return (
        <ellipse
          cx={x + w / 2}
          cy={y + h / 2}
          rx={Math.max(0, w / 2)}
          ry={Math.max(0, h / 2)}
          stroke={a.color}
          strokeWidth={a.thickness}
          fill="none"
          opacity={opacity}
          onClick={onClick}
          style={{ cursor, pointerEvents: onClick ? "stroke" : "none" }}
        />
      )
    }
    case "text_label": {
      const x = a.normalizedX * width
      const y = a.normalizedY * height
      const fontSize = Math.max(10, a.thickness)
      return (
        <text
          x={x}
          y={y + fontSize}
          fill={a.color}
          fontSize={fontSize}
          fontFamily="Inter, system-ui, sans-serif"
          opacity={opacity}
          onClick={onClick}
          style={{ cursor, pointerEvents: onClick ? "all" : "none", userSelect: "none" }}
        >
          {a.content || ""}
        </text>
      )
    }
    case "sticky_note": {
      // Sticky note is rendered as an HTML overlay (see below); skip in SVG.
      return null
    }
    default:
      return null
  }
}

function StickyNotePin({
  annotation,
  width,
  height,
  canDelete,
  onRequestDelete,
  isMobile,
}: {
  annotation: Annotation | DraftAnnotation
  width: number
  height: number
  canDelete: boolean
  onRequestDelete?: () => void
  isMobile: boolean
}) {
  const [open, setOpen] = useState(false)
  const x = annotation.normalizedX * width
  const y = annotation.normalizedY * height

  const style: CSSProperties = {
    position: "absolute",
    left: `${x}px`,
    top: `${y}px`,
    transform: "translate(-50%, -100%)",
  }

  const popoverStyle: CSSProperties = {
    position: "absolute",
    left: `${x + 18}px`,
    top: `${y - 8}px`,
    minWidth: "200px",
    maxWidth: "280px",
    background: annotation.color || "#fde68a",
  }

  const PopoverBody = (
    <>
      {"createdByName" in annotation && annotation.createdByName ? (
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700/80">
          {annotation.createdByName}
        </p>
      ) : null}
      <p className="whitespace-pre-wrap break-words leading-snug">
        {annotation.content || <span className="italic text-slate-500">(empty)</span>}
      </p>
      {canDelete && onRequestDelete ? (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onRequestDelete()
            }}
            className="text-[11px] font-semibold uppercase tracking-wide text-red-700 hover:underline"
          >
            Delete
          </button>
        </div>
      ) : null}
    </>
  )

  return (
    <>
      <button
        type="button"
        style={style}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((value) => !value)
        }}
        className="pointer-events-auto rounded-full p-1 shadow-md ring-1 ring-black/10 transition hover:scale-110"
        title={
          "createdByName" in annotation && annotation.createdByName
            ? `${annotation.createdByName}'s note`
            : "Sticky note"
        }
      >
        <StickyNote
          className="size-5"
          style={{ color: "#0f172a", fill: annotation.color || "#fde68a" }}
        />
      </button>
      {open && isMobile ? (
        <div
          className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:hidden"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-h-[75vh] overflow-y-auto rounded-t-xl p-4 text-sm text-slate-900 shadow-2xl"
            style={{ background: annotation.color || "#fde68a" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-700/80">
                Sticky note
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-700 hover:bg-black/5"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            {PopoverBody}
          </div>
        </div>
      ) : null}
      {open && !isMobile ? (
        <div
          className="pointer-events-auto z-30 rounded-md p-2 text-xs text-slate-900 shadow-xl ring-1 ring-black/10"
          style={popoverStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {PopoverBody}
        </div>
      ) : null}
    </>
  )
}

export function PdfAnnotationLayer(props: PdfAnnotationLayerProps) {
  const {
    width,
    height,
    page,
    annotations,
    drafts,
    enabled,
    showMarkup,
    preset,
    activeTool,
    currentUserId,
    isAdmin,
    onCreate,
    onDelete,
  } = props

  const svgRef = useRef<SVGSVGElement | null>(null)
  const [activeStroke, setActiveStroke] = useState<ActiveStroke | null>(null)
  const [editor, setEditor] = useState<PendingTextEditor | null>(null)
  const [editorValue, setEditorValue] = useState("")
  const isMobile = useIsMobileViewport()

  const isInteractive = enabled && showMarkup
  const isEraseMode = isInteractive && activeTool === "eraser"

  // Filter annotations and drafts to this page.
  const pageAnnotations = useMemo(
    () => annotations.filter((a) => a.page === page),
    [annotations, page],
  )
  const pageDrafts = useMemo(
    () => drafts.filter((d) => d.page === page),
    [drafts, page],
  )

  const finishStroke = useCallback(
    (stroke: ActiveStroke) => {
      const tool = stroke.tool
      if (tool === "pen" || tool === "highlighter") {
        // Need at least 2 points for a stroke.
        if (stroke.points.length < 2) return
        const bbox = pointsBoundingBox(stroke.points)
        onCreate({
          fileId: "",
          page,
          toolType: tool,
          color: stroke.preset.color,
          thickness: stroke.preset.thickness,
          opacity: stroke.preset.opacity,
          normalizedX: bbox.x,
          normalizedY: bbox.y,
          normalizedW: bbox.w,
          normalizedH: bbox.h,
          content: null,
          pathData: stroke.points,
        })
        return
      }

      if (tool === "line" || tool === "arrow") {
        const [sx, sy] = stroke.start
        const [cx, cy] = stroke.current
        const dx = cx - sx
        const dy = cy - sy
        if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) return
        onCreate({
          fileId: "",
          page,
          toolType: tool,
          color: stroke.preset.color,
          thickness: stroke.preset.thickness,
          opacity: stroke.preset.opacity,
          normalizedX: sx,
          normalizedY: sy,
          normalizedW: dx,
          normalizedH: dy,
          content: null,
          pathData: null,
        })
        return
      }

      if (tool === "rectangle" || tool === "ellipse") {
        const bbox = describeShape(tool, stroke.start, stroke.current)
        if (bbox.w < 0.005 && bbox.h < 0.005) return
        onCreate({
          fileId: "",
          page,
          toolType: tool,
          color: stroke.preset.color,
          thickness: stroke.preset.thickness,
          opacity: stroke.preset.opacity,
          normalizedX: bbox.x,
          normalizedY: bbox.y,
          normalizedW: bbox.w,
          normalizedH: bbox.h,
          content: null,
          pathData: null,
        })
      }
    },
    [onCreate, page],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!isInteractive) return
      // In erase mode, the SVG itself is non-drawing — clicks on annotations
      // are handled by their per-shape onClick. Avoid starting a stroke.
      if (activeTool === "eraser") return
      if (preset.tool === "sticky_note" || preset.tool === "text_label") {
        const point = getRelativeCoords(event)
        if (!point) return
        setEditor({ tool: preset.tool, x: point[0], y: point[1], preset })
        setEditorValue("")
        return
      }

      const point = getRelativeCoords(event)
      if (!point) return
      event.preventDefault()
      ;(event.target as Element).setPointerCapture?.(event.pointerId)

      setActiveStroke({
        tool: preset.tool,
        start: point,
        current: point,
        points: [point],
        preset,
      })
    },
    [activeTool, isInteractive, preset],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!activeStroke) return
      const point = getRelativeCoords(event)
      if (!point) return
      setActiveStroke((prev) => {
        if (!prev) return prev
        if (prev.tool === "pen" || prev.tool === "highlighter") {
          return { ...prev, current: point, points: [...prev.points, point] }
        }
        return { ...prev, current: point }
      })
    },
    [activeStroke],
  )

  const onPointerUp = useCallback(() => {
    setActiveStroke((prev) => {
      if (prev) finishStroke(prev)
      return null
    })
  }, [finishStroke])

  // If the user disables markup mode mid-stroke, abort.
  useEffect(() => {
    if (!isInteractive) {
      setActiveStroke(null)
      setEditor(null)
    }
  }, [isInteractive])

  const submitEditor = useCallback(() => {
    if (!editor) return
    const trimmed = editorValue.trim()
    if (!trimmed) {
      setEditor(null)
      setEditorValue("")
      return
    }
    onCreate({
      fileId: "",
      page,
      toolType: editor.tool,
      color: editor.preset.color,
      thickness: editor.preset.thickness,
      opacity: editor.preset.opacity,
      normalizedX: editor.x,
      normalizedY: editor.y,
      normalizedW: 0,
      normalizedH: 0,
      content: trimmed,
      pathData: null,
    })
    setEditor(null)
    setEditorValue("")
  }, [editor, editorValue, onCreate, page])

  const handleAnnotationClick = useCallback(
    (annotation: Annotation) => {
      if (!isEraseMode) return
      const allowed = annotationCanBeDeletedBy(annotation, currentUserId, isAdmin)
      if (!allowed) return
      if (annotation.toolType === "sticky_note" && annotation.content) {
        if (!window.confirm("Delete this sticky note?")) return
      }
      onDelete(annotation.id)
    },
    [currentUserId, isAdmin, isEraseMode, onDelete],
  )

  // Render preview for active stroke.
  const previewAnnotation = useMemo(() => {
    if (!activeStroke) return null
    const tool = activeStroke.tool
    if (tool === "pen" || tool === "highlighter") {
      const bbox = pointsBoundingBox(activeStroke.points)
      return {
        toolType: tool,
        color: activeStroke.preset.color,
        thickness: activeStroke.preset.thickness,
        opacity: activeStroke.preset.opacity,
        normalizedX: bbox.x,
        normalizedY: bbox.y,
        normalizedW: bbox.w,
        normalizedH: bbox.h,
        content: null,
        pathData: activeStroke.points,
      } as Pick<
        Annotation,
        | "toolType"
        | "color"
        | "thickness"
        | "opacity"
        | "normalizedX"
        | "normalizedY"
        | "normalizedW"
        | "normalizedH"
        | "content"
        | "pathData"
      >
    }
    if (tool === "line" || tool === "arrow") {
      const [sx, sy] = activeStroke.start
      const [cx, cy] = activeStroke.current
      return {
        toolType: tool,
        color: activeStroke.preset.color,
        thickness: activeStroke.preset.thickness,
        opacity: activeStroke.preset.opacity,
        normalizedX: sx,
        normalizedY: sy,
        normalizedW: cx - sx,
        normalizedH: cy - sy,
        content: null,
        pathData: null,
      }
    }
    const bbox = describeShape(tool, activeStroke.start, activeStroke.current)
    return {
      toolType: tool,
      color: activeStroke.preset.color,
      thickness: activeStroke.preset.thickness,
      opacity: activeStroke.preset.opacity,
      normalizedX: bbox.x,
      normalizedY: bbox.y,
      normalizedW: bbox.w,
      normalizedH: bbox.h,
      content: null,
      pathData: null,
    }
  }, [activeStroke])

  if (!showMarkup) return null

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0"
        style={{
          // In erase mode the SVG itself is non-interactive — clicks land on
          // the per-shape onClick handler, not the surface. This prevents the
          // SVG from swallowing clicks meant for the annotation.
          pointerEvents: isInteractive && activeTool !== "eraser" ? "auto" : "none",
          cursor: isInteractive
            ? activeTool === "eraser"
              ? "default"
              : preset.tool === "sticky_note" || preset.tool === "text_label"
                ? "text"
                : "crosshair"
            : "default",
          touchAction: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {pageAnnotations.map((a) => {
          const canDelete = annotationCanBeDeletedBy(a, currentUserId, isAdmin)
          return (
            <g key={a.id}>
              {renderAnnotationShape(
                a,
                width,
                height,
                false,
                isEraseMode && canDelete ? () => handleAnnotationClick(a) : undefined,
              )}
            </g>
          )
        })}
        {pageDrafts.map((d) => (
          <g key={d.tempId}>{renderAnnotationShape(d, width, height, true)}</g>
        ))}
        {previewAnnotation
          ? renderAnnotationShape(
              previewAnnotation as Annotation,
              width,
              height,
              true,
            )
          : null}
      </svg>

      {/* Sticky-note pins as HTML overlays so they stay clickable / readable. */}
      {pageAnnotations
        .filter((a) => a.toolType === "sticky_note")
        .map((a) => (
          <StickyNotePin
            key={a.id}
            annotation={a}
            width={width}
            height={height}
            canDelete={annotationCanBeDeletedBy(a, currentUserId, isAdmin)}
            // Explicit Delete button click bypasses the eraser-mode gate
            // since it's an unambiguous user intent.
            onRequestDelete={() => onDelete(a.id)}
            isMobile={isMobile}
          />
        ))}
      {pageDrafts
        .filter((d) => d.toolType === "sticky_note")
        .map((d) => (
          <StickyNotePin
            key={d.tempId}
            annotation={d}
            width={width}
            height={height}
            canDelete={false}
            isMobile={isMobile}
          />
        ))}

      {editor && !isMobile ? (
        <div
          className="pointer-events-auto absolute z-40 w-64 rounded-md bg-white p-2 text-xs text-slate-900 shadow-xl ring-1 ring-black/15"
          style={{
            left: `${editor.x * width}px`,
            top: `${editor.y * height}px`,
            transform: "translate(-50%, 8px)",
          }}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {editor.tool === "sticky_note" ? "Sticky note" : "Text label"}
            </span>
            <button
              type="button"
              onClick={() => {
                setEditor(null)
                setEditorValue("")
              }}
              className="rounded p-0.5 text-slate-500 hover:bg-slate-100"
              title="Cancel"
            >
              <X className="size-3" />
            </button>
          </div>
          <Textarea
            autoFocus
            value={editorValue}
            onChange={(e) => setEditorValue(e.target.value)}
            placeholder={
              editor.tool === "sticky_note" ? "Type your note…" : "Type your label…"
            }
            className="min-h-[60px] resize-none text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submitEditor()
              } else if (e.key === "Escape") {
                e.preventDefault()
                setEditor(null)
                setEditorValue("")
              }
            }}
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditor(null)
                setEditorValue("")
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submitEditor}
              disabled={editorValue.trim().length === 0}
            >
              Save
            </Button>
          </div>
        </div>
      ) : null}

      {editor && isMobile ? (
        <div
          className="pointer-events-auto fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => {
            setEditor(null)
            setEditorValue("")
          }}
        >
          <div
            className="w-full rounded-t-xl bg-white p-4 text-sm text-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {editor.tool === "sticky_note" ? "Sticky note" : "Text label"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditor(null)
                  setEditorValue("")
                }}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                aria-label="Cancel"
              >
                <X className="size-4" />
              </button>
            </div>
            <Textarea
              autoFocus
              value={editorValue}
              onChange={(e) => setEditorValue(e.target.value)}
              placeholder={
                editor.tool === "sticky_note" ? "Type your note…" : "Type your label…"
              }
              className="min-h-[120px] resize-none text-base"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="default"
                onClick={() => {
                  setEditor(null)
                  setEditorValue("")
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="default"
                onClick={submitEditor}
                disabled={editorValue.trim().length === 0}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
