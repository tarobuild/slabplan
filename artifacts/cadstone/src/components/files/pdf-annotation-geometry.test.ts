import assert from "node:assert/strict"
import { describe, test } from "node:test"

import type { Annotation } from "./annotation-types.ts"
import {
  applyDragToAnnotation,
  buildPatchFromDrag,
  type ActiveDrag,
  type Point,
} from "./pdf-annotation-geometry.ts"

const EPS = 1e-9

function approx(actual: number, expected: number, message?: string) {
  assert.ok(
    Math.abs(actual - expected) < EPS,
    message ?? `expected ~${expected} but got ${actual}`,
  )
}

function makeRect(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "anno-1",
    fileId: "file-1",
    page: 1,
    toolType: "rectangle",
    color: "#ff0000",
    thickness: 2,
    opacity: 1,
    normalizedX: 0.2,
    normalizedY: 0.3,
    normalizedW: 0.4,
    normalizedH: 0.2,
    content: null,
    pathData: null,
    createdBy: "user-1",
    createdByName: "Tester",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  }
}

function makeLine(overrides: Partial<Annotation> = {}): Annotation {
  return makeRect({
    id: "line-1",
    toolType: "line",
    normalizedX: 0.2,
    normalizedY: 0.4,
    normalizedW: 0.3, // end at (0.5, 0.5)
    normalizedH: 0.1,
    ...overrides,
  })
}

function makeDrag(
  original: Annotation,
  mode: ActiveDrag["mode"],
  start: Point,
): ActiveDrag {
  return { id: original.id, mode, start, original }
}

describe("applyDragToAnnotation", () => {
  test("move translates a rectangle by the pointer delta", () => {
    const before = makeRect()
    const drag = makeDrag(before, "move", [0.25, 0.35])
    // Pointer moved by (+0.10, +0.05).
    const after = applyDragToAnnotation(before, drag, [0.35, 0.40])
    approx(after.normalizedX, 0.3)
    approx(after.normalizedY, 0.35)
    // Size is preserved on a move.
    approx(after.normalizedW, 0.4)
    approx(after.normalizedH, 0.2)
  })

  test("move clamps so the bbox stays inside the page (no negative origin)", () => {
    const before = makeRect({ normalizedX: 0.05, normalizedY: 0.05 })
    const drag = makeDrag(before, "move", [0.5, 0.5])
    // Pointer dragged far past the top-left → should clamp to origin (0,0).
    const after = applyDragToAnnotation(before, drag, [0.0, 0.0])
    approx(after.normalizedX, 0)
    approx(after.normalizedY, 0)
  })

  test("move clamps so the bbox stays inside the page (right/bottom edges)", () => {
    const before = makeRect({
      normalizedX: 0.5,
      normalizedY: 0.5,
      normalizedW: 0.4,
      normalizedH: 0.4,
    })
    const drag = makeDrag(before, "move", [0.5, 0.5])
    // Pointer dragged far past the bottom-right → origin must be capped at
    // (1 - w, 1 - h) so the shape doesn't escape the page.
    const after = applyDragToAnnotation(before, drag, [1.0, 1.0])
    approx(after.normalizedX, 0.6)
    approx(after.normalizedY, 0.6)
    approx(after.normalizedW, 0.4)
    approx(after.normalizedH, 0.4)
  })

  test("move translates pen pathData by the same clamped delta", () => {
    const before = makeRect({
      toolType: "pen",
      normalizedX: 0.1,
      normalizedY: 0.1,
      normalizedW: 0.2,
      normalizedH: 0.2,
      pathData: [
        [0.1, 0.1],
        [0.2, 0.2],
      ],
    })
    const drag = makeDrag(before, "move", [0.0, 0.0])
    // Move by (+0.05, +0.07).
    const after = applyDragToAnnotation(before, drag, [0.05, 0.07])
    approx(after.normalizedX, 0.15)
    approx(after.normalizedY, 0.17)
    assert.ok(after.pathData)
    assert.equal(after.pathData!.length, 2)
    approx(after.pathData![0][0], 0.15)
    approx(after.pathData![0][1], 0.17)
    approx(after.pathData![1][0], 0.25)
    approx(after.pathData![1][1], 0.27)
  })

  test("resize-br grows the bbox by the pointer delta", () => {
    const before = makeRect()
    const drag = makeDrag(before, "resize-br", [0.6, 0.5])
    const after = applyDragToAnnotation(before, drag, [0.8, 0.6])
    approx(after.normalizedX, 0.2)
    approx(after.normalizedY, 0.3)
    // w grew from 0.4 → 0.6, h grew from 0.2 → 0.3.
    approx(after.normalizedW, 0.6)
    approx(after.normalizedH, 0.3)
  })

  test("resize-tl shrinks toward bottom-right and keeps origin/size in [0,1]", () => {
    const before = makeRect()
    const drag = makeDrag(before, "resize-tl", [0.2, 0.3])
    // Dragging the top-left corner by (+0.1, +0.05) shrinks w/h and moves origin.
    const after = applyDragToAnnotation(before, drag, [0.3, 0.35])
    approx(after.normalizedX, 0.3)
    approx(after.normalizedY, 0.35)
    approx(after.normalizedW, 0.3)
    approx(after.normalizedH, 0.15)
  })

  test("resize-br flips negative width by repositioning the origin", () => {
    const before = makeRect()
    const drag = makeDrag(before, "resize-br", [0.6, 0.5])
    // Dragging the bottom-right corner past the origin produces a negative
    // width; the helper must flip it into a positive bbox.
    const after = applyDragToAnnotation(before, drag, [0.1, 0.5])
    // dx = -0.5 → w = 0.4 - 0.5 = -0.1 → flipped: x' = 0.2 + (-0.1) = 0.1, w = 0.1
    approx(after.normalizedX, 0.1)
    approx(after.normalizedW, 0.1)
    assert.ok(after.normalizedW >= 0, "width must be non-negative after a flip")
  })

  test("endpoint-end moves the line's end point in normalized coords", () => {
    const before = makeLine()
    const drag = makeDrag(before, "endpoint-end", [0.5, 0.5])
    // Move end from (0.5, 0.5) → (0.7, 0.6); start (0.2, 0.4) is unchanged.
    const after = applyDragToAnnotation(before, drag, [0.7, 0.6])
    approx(after.normalizedX, 0.2)
    approx(after.normalizedY, 0.4)
    approx(after.normalizedW, 0.5) // 0.7 - 0.2
    approx(after.normalizedH, 0.2) // 0.6 - 0.4
  })

  test("endpoint-start swaps origin when dragged past the other endpoint", () => {
    const before = makeLine() // start (0.2, 0.4), end (0.5, 0.5)
    const drag = makeDrag(before, "endpoint-start", [0.2, 0.4])
    // Move start to (0.8, 0.7), past the existing end on both axes.
    const after = applyDragToAnnotation(before, drag, [0.8, 0.7])
    // bbox is now (min, max) over the two endpoints.
    approx(after.normalizedX, 0.5)
    approx(after.normalizedY, 0.5)
    approx(after.normalizedW, 0.3)
    approx(after.normalizedH, 0.2)
  })

  test("endpoint moves clamp into [0,1]", () => {
    const before = makeLine()
    const drag = makeDrag(before, "endpoint-end", [0.5, 0.5])
    const after = applyDragToAnnotation(before, drag, [2.0, -1.0])
    // End clamps to (1, 0); start stays at (0.2, 0.4).
    // bbox: x = min(0.2, 1) = 0.2; y = min(0.4, 0) = 0; w = 1 - 0.2; h = 0.4 - 0
    approx(after.normalizedX, 0.2)
    approx(after.normalizedY, 0)
    approx(after.normalizedW, 0.8)
    approx(after.normalizedH, 0.4)
  })
})

describe("buildPatchFromDrag", () => {
  test("returns only the normalized fields that changed", () => {
    const before = makeRect()
    const after = { ...before, normalizedX: 0.5 }
    const patch = buildPatchFromDrag(before, after)
    assert.deepEqual(patch, { normalizedX: 0.5 })
  })

  test("includes every changed normalized geometry field on a resize", () => {
    const before = makeRect()
    const after = {
      ...before,
      normalizedX: 0.25,
      normalizedY: 0.31,
      normalizedW: 0.5,
      normalizedH: 0.4,
    }
    const patch = buildPatchFromDrag(before, after)
    assert.deepEqual(patch, {
      normalizedX: 0.25,
      normalizedY: 0.31,
      normalizedW: 0.5,
      normalizedH: 0.4,
    })
  })

  test("includes pathData when it changed (e.g., pen move)", () => {
    const before = makeRect({
      toolType: "pen",
      pathData: [
        [0.1, 0.1],
        [0.2, 0.2],
      ],
    })
    const movedPath: Array<[number, number]> = [
      [0.15, 0.12],
      [0.25, 0.22],
    ]
    const after = {
      ...before,
      normalizedX: 0.25,
      pathData: movedPath,
    }
    const patch = buildPatchFromDrag(before, after)
    assert.equal(patch.normalizedX, 0.25)
    assert.deepEqual(patch.pathData, movedPath)
  })

  test("returns an empty patch when nothing changed (so onUpdate is skipped)", () => {
    const before = makeRect()
    const patch = buildPatchFromDrag(before, { ...before })
    assert.deepEqual(patch, {})
  })

  test("never sends color/content/thickness fields (drag only updates geometry)", () => {
    const before = makeRect()
    const after = {
      ...before,
      normalizedX: 0.5,
      // These would not change during a drag, but verify that even if they
      // did, buildPatchFromDrag intentionally ignores them — the API treats
      // the request body as a partial PATCH and we don't want stale color or
      // text to be re-sent on a geometry update.
      color: "#00ff00",
      content: "ignored",
      thickness: 99,
    }
    const patch = buildPatchFromDrag(before, after)
    assert.equal(patch.normalizedX, 0.5)
    assert.equal((patch as Record<string, unknown>).color, undefined)
    assert.equal((patch as Record<string, unknown>).content, undefined)
    assert.equal((patch as Record<string, unknown>).thickness, undefined)
  })
})
