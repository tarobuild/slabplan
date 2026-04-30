import assert from "node:assert/strict"
import { describe, test } from "node:test"

import type { Annotation } from "./annotation-types.ts"
import {
  prepareEditorForExistingNote,
  resolveEditorSubmit,
  type PendingTextEditor,
} from "./pdf-annotation-editor.ts"

function makeStickyNote(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "note-1",
    fileId: "file-1",
    page: 3,
    toolType: "sticky_note",
    color: "#fde68a",
    thickness: 2,
    opacity: 1,
    normalizedX: 0.42,
    normalizedY: 0.13,
    normalizedW: 0,
    normalizedH: 0,
    content: "original note text",
    pathData: null,
    createdBy: "user-1",
    createdByName: "Tester",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  }
}

describe("prepareEditorForExistingNote", () => {
  // The Edit button in the sticky-note popover wires straight to this helper
  // — the tests below verify that "click Edit" gives the editor exactly the
  // state it needs to reopen on top of the existing pin with its current text
  // pre-filled.

  test("returns an editor anchored at the existing note's coordinates", () => {
    const note = makeStickyNote({ normalizedX: 0.7, normalizedY: 0.25 })
    const reopened = prepareEditorForExistingNote(note)
    assert.ok(reopened, "Edit must produce an editor for sticky notes")
    assert.equal(reopened.editor.tool, "sticky_note")
    assert.equal(reopened.editor.x, 0.7)
    assert.equal(reopened.editor.y, 0.25)
  })

  test("sets editingId so submit takes the update branch (not create)", () => {
    const note = makeStickyNote()
    const reopened = prepareEditorForExistingNote(note)!
    assert.equal(reopened.editor.editingId, note.id)
  })

  test("prefills the textarea with the existing note's content", () => {
    const note = makeStickyNote({ content: "remember to check the riser" })
    const reopened = prepareEditorForExistingNote(note)!
    assert.equal(reopened.value, "remember to check the riser")
  })

  test("uses an empty value when the existing note has null content", () => {
    const note = makeStickyNote({ content: null })
    const reopened = prepareEditorForExistingNote(note)!
    assert.equal(reopened.value, "")
  })

  test("carries through the note's preset (color/thickness/opacity)", () => {
    const note = makeStickyNote({
      color: "#abcdef",
      thickness: 5,
      opacity: 0.6,
    })
    const reopened = prepareEditorForExistingNote(note)!
    assert.deepEqual(reopened.editor.preset, {
      tool: "sticky_note",
      color: "#abcdef",
      thickness: 5,
      opacity: 0.6,
    })
  })

  test("also reopens text_label annotations (same code path)", () => {
    const label = makeStickyNote({ toolType: "text_label", content: "label" })
    const reopened = prepareEditorForExistingNote(label)!
    assert.equal(reopened.editor.tool, "text_label")
    assert.equal(reopened.editor.editingId, label.id)
  })

  test("returns null for non-text annotations (Edit must not reopen them)", () => {
    for (const toolType of [
      "rectangle",
      "ellipse",
      "line",
      "arrow",
      "pen",
      "highlighter",
    ] as const) {
      const annotation = makeStickyNote({ toolType })
      assert.equal(
        prepareEditorForExistingNote(annotation),
        null,
        `expected ${toolType} to be ignored`,
      )
    }
  })
})

describe("resolveEditorSubmit (Save click)", () => {
  test("editing path issues an update with the trimmed content", () => {
    // This is the "Save" half of the Edit-then-Save flow: opening with the
    // helper above, mutating the textarea, then submitting must flow through
    // resolveEditorSubmit and produce a {kind: "update", patch: {content}}.
    const editor: PendingTextEditor = {
      tool: "sticky_note",
      x: 0.42,
      y: 0.13,
      preset: { tool: "sticky_note", color: "#fde68a", thickness: 2, opacity: 1 },
      editingId: "note-1",
    }
    const result = resolveEditorSubmit(editor, "  updated text  ", 3)
    assert.equal(result.kind, "update")
    if (result.kind !== "update") return
    assert.equal(result.id, "note-1")
    assert.deepEqual(result.patch, { content: "updated text" })
  })

  test("editing path collapses to noop when the textarea is whitespace-only", () => {
    // We don't want the Save button to PATCH the row to an empty string —
    // the existing UI just closes the editor in that case.
    const editor: PendingTextEditor = {
      tool: "sticky_note",
      x: 0,
      y: 0,
      preset: { tool: "sticky_note", color: "#fde68a", thickness: 2, opacity: 1 },
      editingId: "note-1",
    }
    const result = resolveEditorSubmit(editor, "   ", 1)
    assert.deepEqual(result, { kind: "noop" })
  })

  test("create path produces a draft anchored at the editor coordinates", () => {
    // No editingId → this is the "first time placing a sticky note" flow,
    // which is a separate code path from Edit-and-Save but lives in the
    // same helper.
    const editor: PendingTextEditor = {
      tool: "sticky_note",
      x: 0.4,
      y: 0.2,
      preset: { tool: "sticky_note", color: "#fde68a", thickness: 2, opacity: 1 },
    }
    const result = resolveEditorSubmit(editor, "new note", 7)
    assert.equal(result.kind, "create")
    if (result.kind !== "create") return
    assert.equal(result.draft.toolType, "sticky_note")
    assert.equal(result.draft.normalizedX, 0.4)
    assert.equal(result.draft.normalizedY, 0.2)
    assert.equal(result.draft.page, 7)
    assert.equal(result.draft.content, "new note")
  })

  test("noop when the editor is null (no draft to submit)", () => {
    const result = resolveEditorSubmit(null, "anything", 1)
    assert.deepEqual(result, { kind: "noop" })
  })
})
