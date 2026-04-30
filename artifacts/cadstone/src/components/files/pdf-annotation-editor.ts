import type {
  Annotation,
  DraftAnnotation,
  ToolPreset,
} from "./annotation-types"
import type { AnnotationPatch } from "./use-pdf-annotations"

export type PendingTextEditor = {
  tool: "sticky_note" | "text_label"
  x: number
  y: number
  preset: ToolPreset
  // When set, the editor is editing the existing annotation rather than
  // creating a new one.
  editingId?: string
}

export type ReopenedEditor = {
  editor: PendingTextEditor
  value: string
}

/**
 * Build the editor state needed to reopen a sticky-note (or text-label) for
 * editing. Returns null for any other tool type so the caller is forced to
 * handle the unsupported case explicitly.
 *
 * The returned `value` is the existing content so the textarea is prefilled
 * — this is what gives the Edit button its "edit, don't recreate" behavior.
 */
export function prepareEditorForExistingNote(
  annotation: Annotation,
): ReopenedEditor | null {
  if (
    annotation.toolType !== "sticky_note" &&
    annotation.toolType !== "text_label"
  ) {
    return null
  }
  return {
    editor: {
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
    },
    value: annotation.content ?? "",
  }
}

export type EditorSubmitResult =
  | { kind: "noop" }
  | { kind: "update"; id: string; patch: AnnotationPatch }
  | { kind: "create"; draft: Omit<DraftAnnotation, "tempId"> }

/**
 * Decide what should happen when the sticky-note / text-label editor is
 * submitted. Pure so the caller (a React component) only has to handle
 * dispatch + state cleanup.
 */
export function resolveEditorSubmit(
  editor: PendingTextEditor | null,
  rawValue: string,
  page: number,
): EditorSubmitResult {
  if (!editor) return { kind: "noop" }
  const trimmed = rawValue.trim()

  if (editor.editingId) {
    // Editing path: empty content collapses to a no-op (we don't want to
    // PATCH the row to an empty string; the existing UI just closes the
    // editor in that case).
    if (!trimmed) return { kind: "noop" }
    return {
      kind: "update",
      id: editor.editingId,
      patch: { content: trimmed },
    }
  }

  // Creating path: same empty-content guard.
  if (!trimmed) return { kind: "noop" }
  return {
    kind: "create",
    draft: {
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
    },
  }
}
