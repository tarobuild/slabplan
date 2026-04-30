import type { Annotation } from "./annotation-types"
import type { AnnotationPatch } from "./use-pdf-annotations"

export type Point = [number, number]

export type DragMode =
  | "move"
  | "resize-tl"
  | "resize-tr"
  | "resize-bl"
  | "resize-br"
  | "endpoint-start"
  | "endpoint-end"

export type ActiveDrag = {
  id: string
  mode: DragMode
  start: Point
  original: Annotation
}

export function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function applyDragToAnnotation(
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

export function buildPatchFromDrag(
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
