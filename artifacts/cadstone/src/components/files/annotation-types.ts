export type AnnotationToolType =
  | "highlighter"
  | "pen"
  | "line"
  | "arrow"
  | "rectangle"
  | "ellipse"
  | "sticky_note"
  | "text_label"

export type Annotation = {
  id: string
  fileId: string
  page: number
  toolType: AnnotationToolType
  color: string
  thickness: number
  opacity: number
  normalizedX: number
  normalizedY: number
  normalizedW: number
  normalizedH: number
  content: string | null
  pathData: Array<[number, number]> | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

export type DraftAnnotation = Omit<
  Annotation,
  "id" | "createdAt" | "updatedAt" | "createdBy" | "createdByName"
> & {
  // Optimistic local id used until the server returns the real one.
  tempId: string
}

export type ToolPreset = {
  tool: AnnotationToolType
  color: string
  thickness: number
  opacity: number
}

export const HIGHLIGHTER_COLORS = [
  { label: "Yellow", value: "#facc15" },
  { label: "Green", value: "#86efac" },
  { label: "Pink", value: "#f9a8d4" },
] as const

export const PEN_COLORS = [
  { label: "Red", value: "#dc2626" },
  { label: "Blue", value: "#2563eb" },
  { label: "Green", value: "#16a34a" },
  { label: "Gold", value: "#f59e0b" },
  { label: "Black", value: "#111827" },
] as const

export const SHAPE_COLORS = [
  { label: "Red", value: "#dc2626" },
  { label: "Blue", value: "#2563eb" },
  { label: "Green", value: "#16a34a" },
  { label: "Gold", value: "#f59e0b" },
  { label: "Purple", value: "#7c3aed" },
  { label: "Black", value: "#111827" },
] as const

export const STICKY_COLORS = [
  { label: "Yellow", value: "#fde68a" },
  { label: "Pink", value: "#fbcfe8" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Green", value: "#bbf7d0" },
] as const

export const DEFAULT_PRESETS: Record<AnnotationToolType, ToolPreset> = {
  highlighter: { tool: "highlighter", color: "#facc15", thickness: 14, opacity: 0.4 },
  pen: { tool: "pen", color: "#dc2626", thickness: 2, opacity: 1 },
  line: { tool: "line", color: "#dc2626", thickness: 2, opacity: 1 },
  arrow: { tool: "arrow", color: "#dc2626", thickness: 2, opacity: 1 },
  rectangle: { tool: "rectangle", color: "#dc2626", thickness: 2, opacity: 1 },
  ellipse: { tool: "ellipse", color: "#dc2626", thickness: 2, opacity: 1 },
  sticky_note: { tool: "sticky_note", color: "#fde68a", thickness: 1, opacity: 1 },
  text_label: { tool: "text_label", color: "#111827", thickness: 14, opacity: 1 },
}
