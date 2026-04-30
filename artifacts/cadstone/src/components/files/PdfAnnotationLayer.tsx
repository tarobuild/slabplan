import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { Pencil, StickyNote, X } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  HIGHLIGHTER_COLORS,
  PEN_COLORS,
  SHAPE_COLORS,
  STICKY_COLORS,
  type Annotation,
  type AnnotationToolType,
  type DraftAnnotation,
  type ToolPreset,
} from "./annotation-types"
import type { MarkupTool } from "./PdfMarkupToolbar"
import type { AnnotationPatch } from "./use-pdf-annotations"

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
  // When set, the editor is editing the existing annotation rather than
  // creating a new one.
  editingId?: string
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
  onUpdate: (annotationId: string, patch: AnnotationPatch) => void | Promise<void>
}

type DragMode =
  | "move"
  | "resize-tl"
  | "resize-tr"
  | "resize-bl"
  | "resize-br"
  | "endpoint-start"
  | "endpoint-end"

type ActiveDrag = {
  id: string
  mode: DragMode
  start: Point
  original: Annotation
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function getRelativeCoords(
  event: ReactPointerEvent<SVGElement>,
): Point | null {
  // Always measure against the root SVG canvas, not the individual shape or
  // handle that received the event — otherwise a pointerdown on a small handle
  // would compute coordinates relative to the handle's bounding box and the
  // subsequent pointermove (handled on the SVG root) would jump.
  const target = event.currentTarget
  const svg =
    target instanceof SVGSVGElement
      ? target
      : (target.ownerSVGElement ?? null)
  if (!svg) return null
  const rect = svg.getBoundingClientRect()
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

// Edit shares the same authorization rules as delete (creator-or-admin).
const annotationCanBeEditedBy = annotationCanBeDeletedBy

const SUPPORTS_RESIZE: Record<AnnotationToolType, boolean> = {
  highlighter: false,
  pen: false,
  line: true,
  arrow: true,
  rectangle: true,
  ellipse: true,
  sticky_note: false,
  text_label: false,
}

function applyDragToAnnotation(
  source: Annotation,
  drag: ActiveDrag,
  current: Point,
): Annotation {
  const dx = current[0] - drag.start[0]
  const dy = current[1] - drag.start[1]
  const original = drag.original

  if (drag.mode === "move") {
    // Clamp the translation so the bbox stays within the page (origin in [0,1],
    // size unchanged) — keeps the optimistic position aligned with what the
    // server will accept.
    const w = original.normalizedW
    const h = original.normalizedH
    const newX = Math.max(0, Math.min(1 - Math.max(0, w), original.normalizedX + dx))
    const newY = Math.max(0, Math.min(1 - Math.max(0, h), original.normalizedY + dy))
    const cdx = newX - original.normalizedX
    const cdy = newY - original.normalizedY
    if (original.toolType === "pen" || original.toolType === "highlighter") {
      const path =
        original.pathData?.map(([px, py]) => [px + cdx, py + cdy] as Point) ?? null
      return {
        ...source,
        normalizedX: newX,
        normalizedY: newY,
        pathData: path,
      }
    }
    return {
      ...source,
      normalizedX: newX,
      normalizedY: newY,
    }
  }

  if (drag.mode === "endpoint-start" || drag.mode === "endpoint-end") {
    // Compute the start and end points in absolute normalized coords, move the
    // dragged endpoint within the page, then re-derive (origin, size) so
    // width/height stay non-negative — the API schema rejects negatives.
    const startX = original.normalizedX
    const startY = original.normalizedY
    const endX = original.normalizedX + original.normalizedW
    const endY = original.normalizedY + original.normalizedH
    const movedStartX = clamp01(drag.mode === "endpoint-start" ? startX + dx : startX)
    const movedStartY = clamp01(drag.mode === "endpoint-start" ? startY + dy : startY)
    const movedEndX = clamp01(drag.mode === "endpoint-end" ? endX + dx : endX)
    const movedEndY = clamp01(drag.mode === "endpoint-end" ? endY + dy : endY)
    const minX = Math.min(movedStartX, movedEndX)
    const minY = Math.min(movedStartY, movedEndY)
    const maxX = Math.max(movedStartX, movedEndX)
    const maxY = Math.max(movedStartY, movedEndY)
    return {
      ...source,
      normalizedX: minX,
      normalizedY: minY,
      normalizedW: maxX - minX,
      normalizedH: maxY - minY,
    }
  }

  // Rectangle/ellipse corner resize.
  let x = original.normalizedX
  let y = original.normalizedY
  let w = original.normalizedW
  let h = original.normalizedH
  switch (drag.mode) {
    case "resize-tl":
      x += dx
      y += dy
      w -= dx
      h -= dy
      break
    case "resize-tr":
      y += dy
      w += dx
      h -= dy
      break
    case "resize-bl":
      x += dx
      w -= dx
      h += dy
      break
    case "resize-br":
      w += dx
      h += dy
      break
  }
  // Keep width/height non-negative; flip if dragged across the origin so the
  // shape stays sensible.
  if (w < 0) {
    x = x + w
    w = -w
  }
  if (h < 0) {
    y = y + h
    h = -h
  }
  // Clamp to page bounds so optimistic resize stays in [0,1] for both origin
  // and size, matching what the API will accept.
  if (x < 0) {
    w = Math.max(0, w + x)
    x = 0
  }
  if (y < 0) {
    h = Math.max(0, h + y)
    y = 0
  }
  if (x + w > 1) w = Math.max(0, 1 - x)
  if (y + h > 1) h = Math.max(0, 1 - y)
  return {
    ...source,
    normalizedX: x,
    normalizedY: y,
    normalizedW: w,
    normalizedH: h,
  }
}

function buildPatchFromDrag(
  before: Annotation,
  after: Annotation,
): AnnotationPatch {
  const patch: AnnotationPatch = {}
  if (after.normalizedX !== before.normalizedX) patch.normalizedX = after.normalizedX
  if (after.normalizedY !== before.normalizedY) patch.normalizedY = after.normalizedY
  if (after.normalizedW !== before.normalizedW) patch.normalizedW = after.normalizedW
  if (after.normalizedH !== before.normalizedH) patch.normalizedH = after.normalizedH
  if (after.pathData !== before.pathData) patch.pathData = after.pathData ?? null
  return patch
}

function renderAnnotationShape(
  a: Annotation | DraftAnnotation,
  width: number,
  height: number,
  isPending: boolean,
  onClick?: () => void,
  onPointerDown?: (event: ReactPointerEvent<SVGElement>) => void,
  cursorOverride?: CSSProperties["cursor"],
) {
  const opacity = isPending ? a.opacity * 0.6 : a.opacity
  const interactive = !!(onClick || onPointerDown)
  const cursor = cursorOverride ?? (onClick || onPointerDown ? "pointer" : "default")
  const pointerEventsForStroke: CSSProperties["pointerEvents"] = interactive ? "stroke" : "none"
  const pointerEventsForFill: CSSProperties["pointerEvents"] = interactive ? "all" : "none"
  const wrapHandlers = onPointerDown
    ? { onPointerDown }
    : {}

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
          {...wrapHandlers}
          style={{ cursor, pointerEvents: pointerEventsForStroke }}
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
          {...wrapHandlers}
          style={{ cursor, pointerEvents: pointerEventsForStroke }}
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
          {...wrapHandlers}
          style={{ cursor, pointerEvents: pointerEventsForStroke }}
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
          {...wrapHandlers}
          style={{ cursor, pointerEvents: pointerEventsForStroke }}
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
          {...wrapHandlers}
          style={{ cursor, pointerEvents: pointerEventsForStroke }}
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
          {...wrapHandlers}
          style={{ cursor, pointerEvents: pointerEventsForFill, userSelect: "none" }}
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
  canEdit,
  onRequestDelete,
  onRequestEdit,
  isMobile,
}: {
  annotation: Annotation | DraftAnnotation
  width: number
  height: number
  canDelete: boolean
  canEdit: boolean
  onRequestDelete?: () => void
  onRequestEdit?: () => void
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
      {(canEdit && onRequestEdit) || (canDelete && onRequestDelete) ? (
        <div className="mt-3 flex justify-end gap-3">
          {canEdit && onRequestEdit ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onRequestEdit()
              }}
              className="text-[11px] font-semibold uppercase tracking-wide text-slate-800 hover:underline"
            >
              Edit
            </button>
          ) : null}
          {canDelete && onRequestDelete ? (
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
          ) : null}
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

const STYLE_THICKNESS_PRESETS: Array<{ label: string; value: number }> = [
  { label: "Thin", value: 1 },
  { label: "Medium", value: 3 },
  { label: "Thick", value: 6 },
]

function colorSwatchesForTool(
  tool: AnnotationToolType,
): ReadonlyArray<{ label: string; value: string }> {
  if (tool === "highlighter") return HIGHLIGHTER_COLORS
  if (tool === "sticky_note") return STICKY_COLORS
  if (tool === "pen" || tool === "text_label") return PEN_COLORS
  return SHAPE_COLORS
}

function SelectionStyleBar({
  annotation,
  width,
  height,
  onUpdate,
}: {
  annotation: Annotation
  width: number
  height: number
  onUpdate: (id: string, patch: AnnotationPatch) => void | Promise<void>
}) {
  const swatches = colorSwatchesForTool(annotation.toolType)
  // Thickness controls don't apply to sticky notes (font/box presentation only)
  // and aren't useful for text labels (the value drives font size, not stroke).
  const showThickness =
    annotation.toolType !== "sticky_note" && annotation.toolType !== "text_label"

  // Anchor above the annotation's top edge. For lines/arrows we use the bbox
  // of the segment.
  const x = annotation.normalizedX * width
  const y = annotation.normalizedY * height
  const w = Math.max(0, annotation.normalizedW) * width
  const left = x + w / 2
  const top = Math.max(0, y - 8)

  return (
    <div
      className="pointer-events-auto absolute z-30 flex items-center gap-2 rounded-md bg-slate-900/95 px-2 py-1.5 text-white shadow-lg ring-1 ring-white/15"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        transform: "translate(-50%, -100%)",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        {swatches.map((s) => {
          const active = annotation.color === s.value
          return (
            <button
              key={s.value}
              type="button"
              title={s.label}
              onClick={() => {
                if (active) return
                void onUpdate(annotation.id, { color: s.value })
              }}
              className={`h-5 w-5 rounded-full ring-2 transition ${
                active ? "ring-blue-400 scale-110" : "ring-white/30 hover:ring-white/60"
              }`}
              style={{ background: s.value }}
            />
          )
        })}
      </div>
      {showThickness ? (
        <>
          <span className="h-4 w-px bg-white/15" />
          <div className="flex items-center gap-1">
            {STYLE_THICKNESS_PRESETS.map((t) => {
              const active = annotation.thickness === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  title={`${t.label} (${t.value}px)`}
                  onClick={() => {
                    if (active) return
                    void onUpdate(annotation.id, { thickness: t.value })
                  }}
                  className={`flex h-6 items-center rounded px-1.5 text-[11px] transition ${
                    active
                      ? "bg-blue-600 text-white"
                      : "text-slate-200 hover:bg-white/10"
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}

function SelectionOverlay({
  annotation,
  width,
  height,
  canResize,
  onHandlePointerDown,
}: {
  annotation: Annotation
  width: number
  height: number
  canResize: boolean
  onHandlePointerDown: (mode: DragMode, event: ReactPointerEvent<SVGElement>) => void
}) {
  // Compute the bounding box in pixels. For lines/arrows we expand to a
  // rectangle so the user can grab the endpoints visually.
  const isEndpointShape = annotation.toolType === "line" || annotation.toolType === "arrow"
  const x1 = annotation.normalizedX * width
  const y1 = annotation.normalizedY * height
  const x2 = (annotation.normalizedX + annotation.normalizedW) * width
  const y2 = (annotation.normalizedY + annotation.normalizedH) * height
  const bx = Math.min(x1, x2)
  const by = Math.min(y1, y2)
  const bw = Math.abs(x2 - x1)
  const bh = Math.abs(y2 - y1)
  const pad = 4
  const handleSize = 8

  // Build handle definitions per shape kind.
  const handles: Array<{
    cx: number
    cy: number
    mode: DragMode
    cursor: CSSProperties["cursor"]
  }> = []
  if (canResize) {
    if (isEndpointShape) {
      handles.push(
        { cx: x1, cy: y1, mode: "endpoint-start", cursor: "move" },
        { cx: x2, cy: y2, mode: "endpoint-end", cursor: "move" },
      )
    } else if (annotation.toolType === "rectangle" || annotation.toolType === "ellipse") {
      const left = annotation.normalizedX * width
      const top = annotation.normalizedY * height
      const right = (annotation.normalizedX + annotation.normalizedW) * width
      const bottom = (annotation.normalizedY + annotation.normalizedH) * height
      handles.push(
        { cx: left, cy: top, mode: "resize-tl", cursor: "nwse-resize" },
        { cx: right, cy: top, mode: "resize-tr", cursor: "nesw-resize" },
        { cx: left, cy: bottom, mode: "resize-bl", cursor: "nesw-resize" },
        { cx: right, cy: bottom, mode: "resize-br", cursor: "nwse-resize" },
      )
    }
  }

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* Marquee */}
      <rect
        x={bx - pad}
        y={by - pad}
        width={Math.max(0, bw + pad * 2)}
        height={Math.max(0, bh + pad * 2)}
        fill="none"
        stroke="#2563eb"
        strokeWidth={1}
        strokeDasharray="4 3"
        opacity={0.85}
      />
      {handles.map((h) => (
        <rect
          key={h.mode}
          x={h.cx - handleSize / 2}
          y={h.cy - handleSize / 2}
          width={handleSize}
          height={handleSize}
          fill="#ffffff"
          stroke="#2563eb"
          strokeWidth={1.5}
          style={{ cursor: h.cursor, pointerEvents: "all" }}
          onPointerDown={(event) => onHandlePointerDown(h.mode, event)}
        />
      ))}
    </g>
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
    onUpdate,
  } = props

  const svgRef = useRef<SVGSVGElement | null>(null)
  const [activeStroke, setActiveStroke] = useState<ActiveStroke | null>(null)
  const [editor, setEditor] = useState<PendingTextEditor | null>(null)
  const [editorValue, setEditorValue] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)
  const [dragPoint, setDragPoint] = useState<Point | null>(null)
  const isMobile = useIsMobileViewport()

  const isInteractive = enabled && showMarkup
  const isEraseMode = isInteractive && activeTool === "eraser"
  const isSelectMode = isInteractive && activeTool === "select"

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
      // In select mode, clicking the SVG background deselects.
      if (activeTool === "select") {
        setSelectedId(null)
        return
      }
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
      if (activeDrag) {
        const point = getRelativeCoords(event)
        if (point) setDragPoint(point)
        return
      }
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
    [activeDrag, activeStroke],
  )

  const onPointerUp = useCallback(() => {
    if (activeDrag) {
      const original = activeDrag.original
      const current = dragPoint ?? activeDrag.start
      const after = applyDragToAnnotation(original, activeDrag, current)
      const patch = buildPatchFromDrag(original, after)
      if (Object.keys(patch).length > 0) {
        void onUpdate(activeDrag.id, patch)
      }
      setActiveDrag(null)
      setDragPoint(null)
      return
    }
    setActiveStroke((prev) => {
      if (prev) finishStroke(prev)
      return null
    })
  }, [activeDrag, dragPoint, finishStroke, onUpdate])

  // If the user disables markup mode mid-stroke, abort.
  useEffect(() => {
    if (!isInteractive) {
      setActiveStroke(null)
      setEditor(null)
      setSelectedId(null)
      setActiveDrag(null)
      setDragPoint(null)
    }
  }, [isInteractive])

  // Switching away from select mode clears the selection.
  useEffect(() => {
    if (!isSelectMode) {
      setSelectedId(null)
      setActiveDrag(null)
      setDragPoint(null)
    }
  }, [isSelectMode])

  // If the selected annotation disappears (deleted, page change, etc.),
  // clear the selection so handles don't render against a stale row.
  useEffect(() => {
    if (selectedId && !pageAnnotations.some((a) => a.id === selectedId)) {
      setSelectedId(null)
    }
  }, [pageAnnotations, selectedId])

  // Allow Escape to cancel a drag or selection.
  useEffect(() => {
    if (!isInteractive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (activeDrag) {
        e.preventDefault()
        setActiveDrag(null)
        setDragPoint(null)
        return
      }
      if (selectedId) {
        e.preventDefault()
        setSelectedId(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activeDrag, isInteractive, selectedId])

  const submitEditor = useCallback(() => {
    if (!editor) return
    const trimmed = editorValue.trim()
    if (editor.editingId) {
      // Editing an existing annotation — only persist if content changed
      // and is non-empty.
      if (!trimmed) {
        setEditor(null)
        setEditorValue("")
        return
      }
      void onUpdate(editor.editingId, { content: trimmed })
      setEditor(null)
      setEditorValue("")
      return
    }
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
  }, [editor, editorValue, onCreate, onUpdate, page])

  const beginEditStickyNote = useCallback(
    (annotation: Annotation) => {
      if (annotation.toolType !== "sticky_note" && annotation.toolType !== "text_label") {
        return
      }
      setEditor({
        tool: annotation.toolType,
        x: annotation.normalizedX,
        y: annotation.normalizedY,
        preset: {
          tool: annotation.toolType,
          color: annotation.color,
          thickness: annotation.thickness,
          opacity: annotation.opacity,
        },
        editingId: annotation.id,
      })
      setEditorValue(annotation.content ?? "")
    },
    [],
  )

  const handleAnnotationClick = useCallback(
    (annotation: Annotation) => {
      if (isEraseMode) {
        const allowed = annotationCanBeDeletedBy(annotation, currentUserId, isAdmin)
        if (!allowed) return
        if (annotation.toolType === "sticky_note" && annotation.content) {
          if (!window.confirm("Delete this sticky note?")) return
        }
        onDelete(annotation.id)
        return
      }
      if (isSelectMode) {
        // Sticky notes have their own popover with an Edit button — don't
        // hijack the click here.
        if (annotation.toolType === "sticky_note") return
        setSelectedId(annotation.id)
      }
    },
    [currentUserId, isAdmin, isEraseMode, isSelectMode, onDelete],
  )

  const beginAnnotationDrag = useCallback(
    (annotation: Annotation, mode: DragMode, point: Point) => {
      if (!isSelectMode) return
      if (!annotationCanBeEditedBy(annotation, currentUserId, isAdmin)) return
      setSelectedId(annotation.id)
      setActiveDrag({
        id: annotation.id,
        mode,
        start: point,
        original: annotation,
      })
      setDragPoint(point)
    },
    [currentUserId, isAdmin, isSelectMode],
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
          // In select mode the SVG IS interactive so background clicks can
          // deselect, but individual shapes still receive their own events.
          pointerEvents: isInteractive && activeTool !== "eraser" ? "auto" : "none",
          cursor: isInteractive
            ? activeTool === "eraser"
              ? "default"
              : activeTool === "select"
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
          const canEdit = annotationCanBeEditedBy(a, currentUserId, isAdmin)
          // While dragging, render the shape at its in-progress position so
          // the user gets immediate feedback before the patch is committed.
          const displayed =
            activeDrag && activeDrag.id === a.id && dragPoint
              ? applyDragToAnnotation(a, activeDrag, dragPoint)
              : a
          const handleClick = isEraseMode && canDelete ? () => handleAnnotationClick(a) : undefined
          const shapePointerDown =
            isSelectMode && canEdit
              ? (event: ReactPointerEvent<SVGElement>) => {
                  event.stopPropagation()
                  const point = getRelativeCoords(
                    event as unknown as ReactPointerEvent<SVGSVGElement>,
                  )
                  if (!point) return
                  ;(event.target as Element).setPointerCapture?.(event.pointerId)
                  beginAnnotationDrag(a, "move", point)
                }
              : undefined
          const cursorOverride = isSelectMode && canEdit ? "move" : undefined
          return (
            <g key={a.id}>
              {renderAnnotationShape(
                displayed,
                width,
                height,
                false,
                handleClick,
                shapePointerDown,
                cursorOverride,
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
        {/* Selection overlay + resize handles */}
        {isSelectMode && selectedId
          ? (() => {
              const selected = pageAnnotations.find((a) => a.id === selectedId)
              if (!selected) return null
              const canEdit = annotationCanBeEditedBy(selected, currentUserId, isAdmin)
              const displayed =
                activeDrag && activeDrag.id === selected.id && dragPoint
                  ? applyDragToAnnotation(selected, activeDrag, dragPoint)
                  : selected
              return (
                <SelectionOverlay
                  annotation={displayed}
                  width={width}
                  height={height}
                  canResize={canEdit && SUPPORTS_RESIZE[selected.toolType]}
                  onHandlePointerDown={(mode, event) => {
                    event.stopPropagation()
                    const point = getRelativeCoords(
                      event as unknown as ReactPointerEvent<SVGSVGElement>,
                    )
                    if (!point) return
                    ;(event.target as Element).setPointerCapture?.(event.pointerId)
                    beginAnnotationDrag(selected, mode, point)
                  }}
                />
              )
            })()
          : null}
      </svg>

      {/* Style bar (color + thickness) for the selected annotation. */}
      {isSelectMode && selectedId
        ? (() => {
            const selected = pageAnnotations.find((a) => a.id === selectedId)
            if (!selected) return null
            if (!annotationCanBeEditedBy(selected, currentUserId, isAdmin)) return null
            const displayed =
              activeDrag && activeDrag.id === selected.id && dragPoint
                ? applyDragToAnnotation(selected, activeDrag, dragPoint)
                : selected
            return (
              <SelectionStyleBar
                annotation={displayed}
                width={width}
                height={height}
                onUpdate={onUpdate}
              />
            )
          })()
        : null}

      {/* Sticky-note pins as HTML overlays so they stay clickable / readable. */}
      {pageAnnotations
        .filter((a) => a.toolType === "sticky_note")
        .map((a) => {
          const canEditNote = annotationCanBeEditedBy(a, currentUserId, isAdmin)
          return (
            <StickyNotePin
              key={a.id}
              annotation={a}
              width={width}
              height={height}
              canDelete={annotationCanBeDeletedBy(a, currentUserId, isAdmin)}
              canEdit={canEditNote}
              // Explicit Delete button click bypasses the eraser-mode gate
              // since it's an unambiguous user intent.
              onRequestDelete={() => onDelete(a.id)}
              onRequestEdit={canEditNote ? () => beginEditStickyNote(a) : undefined}
              isMobile={isMobile}
            />
          )
        })}
      {pageDrafts
        .filter((d) => d.toolType === "sticky_note")
        .map((d) => (
          <StickyNotePin
            key={d.tempId}
            annotation={d}
            width={width}
            height={height}
            canDelete={false}
            canEdit={false}
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
