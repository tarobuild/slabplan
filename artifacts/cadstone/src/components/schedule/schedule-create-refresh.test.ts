import assert from "node:assert/strict"
import { afterEach, before, describe, test } from "node:test"

import type { ScheduleItemRecord, ScheduleSettings } from "@/lib/schedule"

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
defineGlobal("HTMLInputElement", dom.window.HTMLInputElement)
defineGlobal("Element", dom.window.Element)
defineGlobal("Node", dom.window.Node)
defineGlobal("NodeFilter", dom.window.NodeFilter)
defineGlobal("DocumentFragment", dom.window.DocumentFragment)
defineGlobal("Event", dom.window.Event)
defineGlobal("CustomEvent", dom.window.CustomEvent)
defineGlobal("MouseEvent", dom.window.MouseEvent)
defineGlobal("PointerEvent", dom.window.PointerEvent ?? dom.window.MouseEvent)
defineGlobal("KeyboardEvent", dom.window.KeyboardEvent)
defineGlobal("MutationObserver", dom.window.MutationObserver)
defineGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window))
defineGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
  window.setTimeout(callback, 0),
)
defineGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id))
defineGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const React = await import("react")
defineGlobal("React", React)
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { api } = await import("@/lib/api")
const { FilePreviewProvider } = await import("@/components/files/file-preview-context")
const { ScheduleItemDialog } = await import("./ScheduleItemDialog.tsx")
const { ScheduleQuickCreate } = await import("./ScheduleQuickCreate.tsx")
const { toast } = await import("sonner")

const originalPost = api.post
const originalGet = api.get
const originalToastSuccess = toast.success
const originalToastError = toast.error
const originalToastInfo = toast.info

const settings: ScheduleSettings = {
  phases: [],
  tags: [],
  defaultView: "calendar_month",
  showTimesOnMonthView: true,
  showJobNameOnAllListedJobs: false,
  automaticallyMarkItemsComplete: false,
  includeHeaderOnPdfExports: true,
}

function makeItem(overrides: Partial<ScheduleItemRecord> = {}): ScheduleItemRecord {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    jobId: "44444444-4444-4444-4444-444444444444",
    title: "Template",
    displayColor: "#2563eb",
    startDate: "2026-05-18",
    endDate: "2026-05-18",
    workDays: 1,
    isHourly: true,
    startTime: "08:00",
    endTime: "09:00",
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
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    deletedAt: null,
    status: "upcoming",
    ...overrides,
  }
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  )
  assert.ok(button, `Expected button "${text}" to exist`)
  return button as HTMLButtonElement
}

before(() => {
  window.HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  api.post = originalPost
  api.get = originalGet
  toast.success = originalToastSuccess
  toast.error = originalToastError
  toast.info = originalToastInfo
  document.body.innerHTML = ""
})

describe("schedule create refresh failures", () => {
  test("quick create treats onSaved rejection as refresh failure, not create failure", async () => {
    const item = makeItem({ title: "Pour slab" })
    let postCount = 0
    const openChanges: boolean[] = []
    const successToasts: string[] = []
    const errorToasts: string[] = []
    const infoToasts: string[] = []

    api.post = (async () => {
      postCount += 1
      return { data: { item } }
    }) as typeof api.post
    toast.success = ((message: string) => successToasts.push(message)) as typeof toast.success
    toast.error = ((message: string) => errorToasts.push(message)) as typeof toast.error
    toast.info = ((message: string) => infoToasts.push(message)) as typeof toast.info

    function Host() {
      const [open, setOpen] = React.useState(true)
      return React.createElement(ScheduleQuickCreate, {
        open,
        onOpenChange(nextOpen: boolean) {
          openChanges.push(nextOpen)
          setOpen(nextOpen)
        },
        jobId: item.jobId ?? "",
        users: [],
        initialDate: item.startDate,
        onSaved: async () => {
          throw new Error("refresh failed")
        },
        onMoreOptions: () => {},
      })
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(React.createElement(Host))
    })

    await act(async () => {
      setInputValue(document.querySelector("#quick-create-title") as HTMLInputElement, "Pour slab")
      buttonByText("Create").click()
      await Promise.resolve()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    assert.equal(postCount, 1)
    assert.deepEqual(openChanges, [false])
    assert.deepEqual(successToasts, ["Schedule item created"])
    assert.deepEqual(infoToasts, ["Schedule item created, but the schedule could not refresh."])
    assert.deepEqual(errorToasts, [])
    assert.equal(document.querySelector("#quick-create-error"), null)

    await act(async () => {
      root.unmount()
    })
  })

  test("full dialog treats onRefresh rejection as refresh failure after create", async () => {
    const item = makeItem({ title: "Template install" })
    let postCount = 0
    let getCount = 0
    const successToasts: string[] = []
    const errorToasts: string[] = []
    const infoToasts: string[] = []

    api.post = (async () => {
      postCount += 1
      return { data: { item } }
    }) as typeof api.post
    api.get = (async () => {
      getCount += 1
      return { data: { item } }
    }) as typeof api.get
    toast.success = ((message: string) => successToasts.push(message)) as typeof toast.success
    toast.error = ((message: string) => errorToasts.push(message)) as typeof toast.error
    toast.info = ((message: string) => infoToasts.push(message)) as typeof toast.info

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        React.createElement(
          FilePreviewProvider,
          null,
          React.createElement(ScheduleItemDialog, {
            open: true,
            onOpenChange: () => {},
            jobId: item.jobId ?? "",
            itemId: null,
            initialStartDate: item.startDate,
            items: [],
            users: [],
            settings,
            workdayExceptions: [],
            refreshSettings: async () => {},
            onRefresh: async () => {
              throw new Error("refresh failed")
            },
          }),
        ),
      )
    })

    await act(async () => {
      setInputValue(document.querySelector("#schedule-item-title") as HTMLInputElement, "Template install")
      const saveButtons = Array.from(document.querySelectorAll("button")).filter(
        (button) => button.textContent?.trim() === "Save",
      )
      assert.ok(saveButtons.length > 0, "Expected at least one Save button")
      ;(saveButtons.at(-1) as HTMLButtonElement).click()
      await Promise.resolve()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    assert.equal(postCount, 1)
    assert.equal(getCount, 1)
    assert.deepEqual(successToasts, ["Schedule item created"])
    assert.deepEqual(infoToasts, ["Schedule item saved, but the schedule could not refresh."])
    assert.ok(
      !errorToasts.includes("Failed to save schedule item"),
      "Create success should not be reported as a save failure",
    )

    await act(async () => {
      root.unmount()
    })
  })

  test("draft copy uses the returned copied item without reloading stale props", async () => {
    const originalItem = makeItem({
      id: "11111111-1111-1111-1111-111111111111",
      title: "Template install",
    })
    const copiedItem = makeItem({
      id: "22222222-2222-2222-2222-222222222222",
      title: "Template install (Copy)",
    })
    let draftSaveCount = 0
    const successToasts: string[] = []
    const errorToasts: string[] = []

    toast.success = ((message: string) => successToasts.push(message)) as typeof toast.success
    toast.error = ((message: string) => errorToasts.push(message)) as typeof toast.error

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        React.createElement(
          FilePreviewProvider,
          null,
          React.createElement(ScheduleItemDialog, {
            open: true,
            onOpenChange: () => {},
            jobId: originalItem.jobId ?? "",
            itemId: originalItem.id,
            items: [originalItem],
            users: [],
            settings,
            workdayExceptions: [],
            refreshSettings: async () => {},
            onRefresh: async () => {},
            draftMode: true,
            onDraftSave: async () => {
              draftSaveCount += 1
              return copiedItem
            },
          }),
        ),
      )
      await Promise.resolve()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    await act(async () => {
      const moreButton = document.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
      assert.ok(moreButton, "Expected copy menu trigger")
      moreButton.dispatchEvent(
        new window.PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      )
      moreButton.click()
      await Promise.resolve()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    await act(async () => {
      const copyItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (candidate) => candidate.textContent?.trim() === "Copy",
      ) as HTMLElement | undefined
      assert.ok(copyItem, "Expected copy menu item")
      copyItem.click()
      await Promise.resolve()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    assert.equal(draftSaveCount, 1)
    assert.deepEqual(successToasts, ["Schedule item copied"])
    assert.deepEqual(errorToasts, [])
    assert.equal(
      (document.querySelector("#schedule-item-title") as HTMLInputElement).value,
      "Template install (Copy)",
    )

    await act(async () => {
      root.unmount()
    })
  })

  test("stale item loads do not overwrite a newer dialog item", async () => {
    const slowItem = makeItem({
      id: "11111111-1111-1111-1111-111111111111",
      title: "Slow stale item",
    })
    const currentItem = makeItem({
      id: "22222222-2222-2222-2222-222222222222",
      title: "Current item",
    })
    const pendingGets = new Map<string, (value: { data: { item: ScheduleItemRecord } }) => void>()
    let setItemId!: (itemId: string) => void

    api.get = ((url: string) =>
      new Promise((resolve) => {
        pendingGets.set(url, resolve as (value: { data: { item: ScheduleItemRecord } }) => void)
      })) as typeof api.get

    function Host() {
      const [itemId, setHostItemId] = React.useState(slowItem.id)
      setItemId = setHostItemId
      return React.createElement(
        FilePreviewProvider,
        null,
        React.createElement(ScheduleItemDialog, {
          open: true,
          onOpenChange: () => {},
          jobId: slowItem.jobId ?? "",
          itemId,
          items: [],
          users: [],
          settings,
          workdayExceptions: [],
          refreshSettings: async () => {},
          onRefresh: async () => {},
        }),
      )
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(React.createElement(Host))
      await Promise.resolve()
    })

    await act(async () => {
      setItemId(currentItem.id)
      await Promise.resolve()
    })

    await act(async () => {
      pendingGets.get(`/schedule-items/${currentItem.id}`)?.({ data: { item: currentItem } })
      await Promise.resolve()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    assert.equal(
      (document.querySelector("#schedule-item-title") as HTMLInputElement).value,
      "Current item",
    )

    await act(async () => {
      pendingGets.get(`/schedule-items/${slowItem.id}`)?.({ data: { item: slowItem } })
      await Promise.resolve()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    assert.equal(
      (document.querySelector("#schedule-item-title") as HTMLInputElement).value,
      "Current item",
    )

    await act(async () => {
      root.unmount()
    })
  })
})
