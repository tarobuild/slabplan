import assert from "node:assert/strict"
import { afterEach, before, beforeEach, describe, test } from "node:test"

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
defineGlobal("PointerEvent", dom.window.PointerEvent ?? dom.window.MouseEvent)
defineGlobal("MouseEvent", dom.window.MouseEvent)
defineGlobal("KeyboardEvent", dom.window.KeyboardEvent)
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
const { ScheduleToolbar } = await import("./ScheduleToolbar.tsx")

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

async function renderToolbar(
  overrides: Partial<React.ComponentProps<typeof ScheduleToolbar>> = {},
) {
  let newItemClicks = 0
  const props: React.ComponentProps<typeof ScheduleToolbar> = {
    viewMode: "calendar",
    setViewMode: () => {},
    setSettingsOpen: () => {},
    setHistoryOpen: () => {},
    setTodosPanelOpen: () => {},
    setTemplateDialogOpen: () => {},
    setFilterOpen: () => {},
    incompleteTodoCount: 0,
    scheduleOffline: false,
    draftPublishing: false,
    draftPastLength: 0,
    draftFutureLength: 0,
    activeFilterCount: 0,
    hasActiveItems: false,
    canWrite: false,
    canCreateScheduleItems: false,
    enterDraftMode: () => {},
    handleDiscardDraft: () => {},
    handleDraftUndo: () => {},
    handleDraftRedo: () => {},
    handleTrackConflicts: () => {},
    handleNotifyAssignedUsers: () => {},
    handleDeleteAllItems: () => {},
    handleExport: () => {},
    runSchedulePrint: () => {},
    openNewItem: () => {
      newItemClicks += 1
    },
    handlePublishDraft: () => {},
    ...overrides,
  }

  await act(async () => {
    root.render(createElement(ScheduleToolbar, props))
  })
  return { getNewItemClicks: () => newItemClicks }
}

function buttonWithText(text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes(text),
  ) as HTMLButtonElement | undefined
}

describe("ScheduleToolbar create permissions", () => {
  test("shows schedule-item creation without exposing admin schedule controls", async () => {
    const state = await renderToolbar({
      canCreateScheduleItems: true,
      canWrite: false,
    })

    const newButton = buttonWithText("New Schedule Item")
    assert.ok(newButton, "drafter create access should show the new item button")
    assert.equal(container.textContent?.includes("Schedule Offline"), false)
    assert.equal(container.textContent?.includes("Publish Changes"), false)

    await act(async () => {
      newButton.click()
    })

    assert.equal(state.getNewItemClicks(), 1)
  })

  test("hides schedule-item creation from read-only users", async () => {
    await renderToolbar({
      canCreateScheduleItems: false,
      canWrite: false,
    })

    assert.equal(buttonWithText("New Schedule Item"), undefined)
  })
})
