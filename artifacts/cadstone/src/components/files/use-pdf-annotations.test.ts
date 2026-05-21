import assert from "node:assert/strict"
import { afterEach, before, beforeEach, describe, test } from "node:test"
import type { UsePdfAnnotationsResult } from "./use-pdf-annotations.ts"

import { JSDOM } from "jsdom"

type AnnotationResponse = { data: { annotations: ReturnType<typeof serverAnnotation>[] } }

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
})

function defineGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
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
defineGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const React = await import("react")
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { api } = await import("@/lib/api")
const { usePdfAnnotations } = await import("./use-pdf-annotations.ts")

type ApiMethod = typeof api.post
type ApiGetMethod = typeof api.get

const originalGet = api.get
const originalPost = api.post
const originalDelete = api.delete
const originalSetTimeout = dom.window.setTimeout.bind(dom.window)
const originalClearTimeout = dom.window.clearTimeout.bind(dom.window)

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

before(() => {
  api.get = (async () => ({ data: { annotations: [] } })) as typeof api.get
  api.delete = (async () => ({ data: {} })) as typeof api.delete
})

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  api.get = (async () => ({ data: { annotations: [] } })) as typeof api.get
  api.post = originalPost
  dom.window.setTimeout = originalSetTimeout
  dom.window.clearTimeout = originalClearTimeout
})

function serverAnnotation(id: string, fileId: string) {
  return {
    id,
    fileId,
    page: 1,
    toolType: "rectangle",
    color: "#167A4A",
    thickness: 2,
    opacity: 1,
    normalizedX: 0.1,
    normalizedY: 0.1,
    normalizedW: 0.2,
    normalizedH: 0.2,
    content: null,
    pathData: null,
    createdBy: "user-1",
    createdByName: "User One",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function installWindowTimers() {
  let nextId = 1
  const timers = new Map<number, () => void>()

  dom.window.setTimeout = ((callback: TimerHandler) => {
    const id = nextId
    nextId += 1
    timers.set(id, () => {
      if (typeof callback === "function") {
        callback()
      }
    })
    return id
  }) as typeof dom.window.setTimeout

  dom.window.clearTimeout = ((id?: number) => {
    if (typeof id === "number") {
      timers.delete(id)
    }
  }) as typeof dom.window.clearTimeout

  return {
    runAll: () => {
      const pending = [...timers.values()]
      timers.clear()
      for (const callback of pending) {
        callback()
      }
    },
  }
}

describe("usePdfAnnotations", () => {
  test("ignores stale annotation refreshes after fileId changes", async () => {
    let resolveA: ((value: AnnotationResponse) => void) | null = null
    let resolveB: ((value: AnnotationResponse) => void) | null = null
    const getAnnotationResponse = (url: string): Promise<AnnotationResponse> => {
      if (url.includes("/files/file-a/")) {
        return new Promise<AnnotationResponse>((resolve) => {
          resolveA = resolve
        })
      }
      if (url.includes("/files/file-b/")) {
        return new Promise<AnnotationResponse>((resolve) => {
          resolveB = resolve
        })
      }
      return Promise.resolve({ data: { annotations: [] } })
    }
    api.get = getAnnotationResponse as ApiGetMethod

    let latest: UsePdfAnnotationsResult | null = null
    function Harness({ fileId }: { fileId: string }) {
      latest = usePdfAnnotations({ fileId, enabled: true })
      return null
    }

    await act(async () => {
      root.render(React.createElement(Harness, { fileId: "file-a" }))
    })
    await act(async () => {
      root.render(React.createElement(Harness, { fileId: "file-b" }))
    })

    await act(async () => {
      resolveB?.({ data: { annotations: [serverAnnotation("ann-b", "file-b")] } })
    })
    assert.equal((latest as UsePdfAnnotationsResult | null)?.annotations[0]?.id, "ann-b")

    await act(async () => {
      resolveA?.({ data: { annotations: [serverAnnotation("ann-a", "file-a")] } })
    })
    assert.equal((latest as UsePdfAnnotationsResult | null)?.annotations[0]?.id, "ann-b")
  })

  test("does not persist a just-created annotation after undo cancels it", async () => {
    const timers = installWindowTimers()
    let postCalls = 0
    api.post = (async () => {
      postCalls += 1
      return {
        data: {
          annotation: {
            id: "ann-1",
            fileId: "file-1",
            page: 1,
            toolType: "rectangle",
            color: "#167A4A",
            thickness: 2,
            opacity: 1,
            normalizedX: 0.1,
            normalizedY: 0.1,
            normalizedW: 0.2,
            normalizedH: 0.2,
            content: null,
            pathData: null,
            createdBy: "user-1",
            createdByName: "User One",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }
    }) as ApiMethod

    let latest: UsePdfAnnotationsResult | null = null
    const getLatest = () => {
      if (!latest) {
        throw new Error("usePdfAnnotations did not render")
      }
      return latest as UsePdfAnnotationsResult
    }
    function Harness() {
      latest = usePdfAnnotations({ fileId: "file-1", enabled: true })
      return null
    }

    await act(async () => {
      root.render(React.createElement(Harness))
    })

    await act(async () => {
      getLatest().createAnnotation({
        fileId: "file-1",
        page: 1,
        toolType: "rectangle",
        color: "#167A4A",
        thickness: 2,
        opacity: 1,
        normalizedX: 0.1,
        normalizedY: 0.1,
        normalizedW: 0.2,
        normalizedH: 0.2,
        content: null,
        pathData: null,
      })
    })

    assert.equal(getLatest().drafts.length, 1)

    await act(async () => {
      getLatest().undo()
    })

    await act(async () => {
      timers.runAll()
    })

    assert.equal(postCalls, 0)
    assert.equal(getLatest().drafts.length, 0)
    assert.equal(getLatest().annotations.length, 0)
  })
})
