import {
  Eraser,
  Highlighter,
  Minus,
  MousePointer2,
  MousePointer,
  Pencil,
  Square,
  StickyNote,
  Type,
  Circle as CircleIcon,
  ArrowUpRight,
  Eye,
  EyeOff,
  Undo2,
  Redo2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  HIGHLIGHTER_COLORS,
  PEN_COLORS,
  SHAPE_COLORS,
  STICKY_COLORS,
  type AnnotationToolType,
  type ToolPreset,
} from "./annotation-types"

export type MarkupTool = AnnotationToolType | "eraser" | "select"

type Props = {
  active: MarkupTool
  presets: Record<AnnotationToolType, ToolPreset>
  onSelectTool: (tool: MarkupTool) => void
  onChangePreset: (tool: AnnotationToolType, preset: ToolPreset) => void
  showMarkup: boolean
  onToggleShowMarkup: (next: boolean) => void
  filterMine: boolean
  onToggleFilterMine: (next: boolean) => void
  onUndo: () => void
  canUndo: boolean
  onRedo: () => void
  canRedo: boolean
  onExitMarkup: () => void
  totalAnnotations: number
  visibleAnnotations: number
}

type ToolButtonProps = {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
  disabled?: boolean
  ariaLabel?: string
}

function ToolButton({
  active,
  onClick,
  title,
  children,
  disabled = false,
  ariaLabel,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition ${
        active
          ? "bg-blue-600 text-white shadow"
          : "text-slate-200 hover:bg-white/10 hover:text-white"
      } ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-slate-200" : ""}`}
    >
      {children}
    </button>
  )
}

function ColorSwatch({
  color,
  active,
  onClick,
  title,
}: {
  color: string
  active: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || color}
      className={`h-5 w-5 rounded-full ring-2 transition ${
        active ? "ring-blue-400 scale-110" : "ring-white/30 hover:ring-white/60"
      }`}
      style={{ background: color }}
    />
  )
}

export function PdfMarkupToolbar({
  active,
  presets,
  onSelectTool,
  onChangePreset,
  showMarkup,
  onToggleShowMarkup,
  filterMine,
  onToggleFilterMine,
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  onExitMarkup,
  totalAnnotations,
  visibleAnnotations,
}: Props) {
  const presetTool =
    active === "eraser" || active === "select" ? null : presets[active]
  const swatches =
    active === "highlighter"
      ? HIGHLIGHTER_COLORS
      : active === "pen"
        ? PEN_COLORS
        : active === "sticky_note"
          ? STICKY_COLORS
          : active === "text_label"
            ? PEN_COLORS
            : SHAPE_COLORS

  const showThickness =
    active !== "sticky_note" &&
    active !== "text_label" &&
    active !== "eraser" &&
    active !== "select"
  const showOpacity = active === "highlighter"
  const showFontSize = active === "text_label"

  return (
    <div className="flex flex-col gap-2 border-b border-white/10 bg-slate-950/85 px-3 py-2 text-white">
      <div className="flex flex-wrap items-center gap-1.5">
        <ToolButton
          active={active === "select"}
          onClick={() => onSelectTool("select")}
          title="Select / move (click a markup to edit)"
        >
          <MousePointer className="size-4" />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <ToolButton
          active={active === "highlighter"}
          onClick={() => onSelectTool("highlighter")}
          title="Highlighter"
        >
          <Highlighter className="size-4" />
        </ToolButton>
        <ToolButton
          active={active === "pen"}
          onClick={() => onSelectTool("pen")}
          title="Freehand pen"
        >
          <Pencil className="size-4" />
        </ToolButton>
        <ToolButton
          active={active === "line"}
          onClick={() => onSelectTool("line")}
          title="Straight line"
        >
          <Minus className="size-4" />
        </ToolButton>
        <ToolButton
          active={active === "arrow"}
          onClick={() => onSelectTool("arrow")}
          title="Arrow"
        >
          <ArrowUpRight className="size-4" />
        </ToolButton>
        <ToolButton
          active={active === "rectangle"}
          onClick={() => onSelectTool("rectangle")}
          title="Rectangle"
        >
          <Square className="size-4" />
        </ToolButton>
        <ToolButton
          active={active === "ellipse"}
          onClick={() => onSelectTool("ellipse")}
          title="Ellipse"
        >
          <CircleIcon className="size-4" />
        </ToolButton>
        <ToolButton
          active={active === "sticky_note"}
          onClick={() => onSelectTool("sticky_note")}
          title="Sticky note"
        >
          <StickyNote className="size-4" />
        </ToolButton>
        <ToolButton
          active={active === "text_label"}
          onClick={() => onSelectTool("text_label")}
          title="Text label"
        >
          <Type className="size-4" />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <ToolButton
          active={active === "eraser"}
          onClick={() => onSelectTool("eraser")}
          title="Eraser (click an annotation to delete)"
        >
          <Eraser className="size-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-white/15" />

        <ToolButton
          active={false}
          onClick={onUndo}
          disabled={!canUndo}
          title={
            canUndo
              ? "Undo last markup change (your own create, edit, or delete)"
              : "Nothing to undo"
          }
          ariaLabel="Undo last markup change"
        >
          <Undo2 className="size-4" />
        </ToolButton>
        <ToolButton
          active={false}
          onClick={onRedo}
          disabled={!canRedo}
          title={canRedo ? "Redo last undone markup change" : "Nothing to redo"}
          ariaLabel="Redo last undone markup change"
        >
          <Redo2 className="size-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-white/15" />

        <button
          type="button"
          onClick={() => onToggleShowMarkup(!showMarkup)}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
            showMarkup
              ? "bg-white/10 text-white"
              : "text-white/70 hover:bg-white/10"
          }`}
          title={showMarkup ? "Hide markup" : "Show markup"}
        >
          {showMarkup ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          {showMarkup ? "Markup on" : "Markup hidden"}
        </button>

        <button
          type="button"
          onClick={() => onToggleFilterMine(!filterMine)}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
            filterMine ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/10"
          }`}
          title="Filter to just my annotations"
        >
          <MousePointer2 className="size-3.5" />
          {filterMine ? "Just mine" : "Everyone's"}
        </button>

        <span className="ml-1 hidden text-[11px] text-white/40 sm:inline">
          {visibleAnnotations} / {totalAnnotations} shown
        </span>

        <div className="flex-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onExitMarkup}
          className="h-7 text-white hover:bg-white/10 hover:text-white"
        >
          <X className="mr-1 size-3.5" />
          Exit markup
        </Button>
      </div>

      {presetTool ? (
        <div className="flex flex-wrap items-center gap-3 px-1 text-xs text-white/70">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-white/50">
              Color
            </span>
            {swatches.map((s) => (
              <ColorSwatch
                key={s.value}
                color={s.value}
                active={presetTool.color === s.value}
                onClick={() =>
                  onChangePreset(presetTool.tool, {
                    ...presetTool,
                    color: s.value,
                  })
                }
                title={s.label}
              />
            ))}
          </div>
          {showThickness ? (
            <div className="flex min-w-[160px] items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-white/50">
                Thickness
              </span>
              <Slider
                min={1}
                max={20}
                step={1}
                value={[presetTool.thickness]}
                onValueChange={([next]) =>
                  onChangePreset(presetTool.tool, {
                    ...presetTool,
                    thickness: next ?? presetTool.thickness,
                  })
                }
                className="w-32"
              />
              <span className="w-6 tabular-nums">{presetTool.thickness}</span>
            </div>
          ) : null}
          {showFontSize ? (
            <div className="flex min-w-[160px] items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-white/50">
                Font size
              </span>
              <Slider
                min={10}
                max={48}
                step={1}
                value={[presetTool.thickness]}
                onValueChange={([next]) =>
                  onChangePreset(presetTool.tool, {
                    ...presetTool,
                    thickness: next ?? presetTool.thickness,
                  })
                }
                className="w-32"
              />
              <span className="w-6 tabular-nums">{presetTool.thickness}</span>
            </div>
          ) : null}
          {showOpacity ? (
            <div className="flex min-w-[140px] items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-white/50">
                Opacity
              </span>
              <Slider
                min={0.1}
                max={1}
                step={0.05}
                value={[presetTool.opacity]}
                onValueChange={([next]) =>
                  onChangePreset(presetTool.tool, {
                    ...presetTool,
                    opacity: next ?? presetTool.opacity,
                  })
                }
                className="w-28"
              />
              <span className="w-9 tabular-nums">
                {Math.round(presetTool.opacity * 100)}%
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
