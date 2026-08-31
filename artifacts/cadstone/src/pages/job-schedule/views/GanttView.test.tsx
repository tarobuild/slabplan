import assert from "node:assert/strict"
import { afterEach, before, beforeEach, test } from "node:test"

import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
})

function defineGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
  })
}

defineGlobal("window", dom.window)
defineGlobal("document", dom.window.document)
defineGlobal("navigator", dom.window.navigator)
defineGlobal("HTMLElement", dom.window.HTMLElement)
defineGlobal("Element", dom.window.Element)
defineGlobal("Node", dom.window.Node)
defineGlobal("DocumentFragment", dom.window.DocumentFragment)
defineGlobal("CustomEvent", dom.window.CustomEvent)
defineGlobal("MutationObserver", dom.window.MutationObserver)
defineGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window))
defineGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const React = await import("react")
defineGlobal("React", React)
const { createElement } = React
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { GanttView } = await import("./GanttView.tsx")

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

before(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  container = dom.window.document.createElement("div")
  dom.window.document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

test("Gantt task labels and icon-only controls expose full hover labels", async () => {
  const item = {
    id: "task-1",
    jobId: "job-1",
    title: "Design review and approval",
    displayColor: "#2563eb",
    startDate: "2026-08-20",
    endDate: "2026-08-20",
    workDays: 1,
    isHourly: false,
    startTime: null,
    endTime: null,
    progress: 0,
    reminder: null,
    showOnGantt: true,
    visibleToEstimators: true,
    visibleToInstallers: true,
    visibleToOfficeStaff: true,
    isComplete: false,
    isPersonalTodo: false,
    notes: null,
    tags: [],
    phaseId: null,
    phaseName: null,
    assigneeIds: [],
    assignees: [],
    predecessors: [],
    notesStream: [],
    noteCount: 0,
    attachments: [],
    relatedTodos: [],
    relatedTodoCount: 0,
    createdBy: null,
    createdByName: null,
    createdByAvatarUrl: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    deletedAt: null,
    status: "scheduled",
  }
  await act(async () => {
    root.render(createElement(GanttView, {
      ganttFullscreen: false,
      ganttScale: "day",
      ganttShowPhases: false,
      ganttCriticalPath: false,
      loading: false,
      canWrite: true,
      canCreateScheduleItems: true,
      ganttItems: [item],
      activeItems: [item],
      ganttRows: [{ key: item.id, type: "item", item }],
      activeConflictIds: new Set<string>(),
      ganttTimelineRef: { current: null },
      timelineWidth: 120,
      monthGroups: [{ key: "2026-08", label: "August 2026", width: 120 }],
      scaleUnits: [{
        key: "2026-08-20",
        label: "20 Thu",
        start: new Date(2026, 7, 20),
        end: new Date(2026, 7, 20),
        width: 120,
      }],
      todayOffsetPx: 60,
      schedulePreview: null,
      ganttPreviewBounds: null,
      ganttDependencyLines: [],
      ganttDrag: null,
      ganttClickSuppressRef: { current: null },
      criticalPathIds: new Set<string>(),
      ganttRange: {
        start: new Date(2026, 7, 20),
        end: new Date(2026, 7, 20),
      },
      dayWidth: 120,
      workdayExceptions: [],
      scheduleOffline: false,
      setGanttScale: () => {},
      setGanttShowPhases: () => {},
      setGanttCriticalPath: () => {},
      setGanttFullscreen: () => {},
      setAppliedFilters: () => {},
      setDraftFilters: () => {},
      scrollGanttToToday: () => {},
      openNewItem: () => {},
      openExistingItem: () => {},
      enterDraftMode: () => {},
      handleGanttBarPointerDown: () => {},
      isGanttBarDraggable: () => true,
    } as React.ComponentProps<typeof GanttView>))
  })

  const task = container.querySelector<HTMLElement>("[data-testid='gantt-task-task-1']")
  assert.equal(task?.title, item.title)
  assert.ok(container.querySelector(`[title='${item.title}']`))
  assert.ok(container.querySelector("button[aria-label='Enter fullscreen']"))
  assert.ok(container.querySelector("button[aria-label='Edit Design review and approval']"))
  assert.ok(container.querySelector("button[aria-label='Add schedule item']"))
  const timelineScroller = container.querySelector("[data-testid='gantt-timeline-scroller']")
  assert.match(timelineScroller?.parentElement?.className ?? "", /\bmin-w-0\b/)
  assert.match(timelineScroller?.parentElement?.className ?? "", /\bw-full\b/)
})
