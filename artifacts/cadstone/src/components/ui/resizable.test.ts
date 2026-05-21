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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

defineGlobal("window", dom.window)
defineGlobal("document", dom.window.document)
defineGlobal("navigator", dom.window.navigator)
defineGlobal("HTMLElement", dom.window.HTMLElement)
defineGlobal("Node", dom.window.Node)
defineGlobal("Element", dom.window.Element)
defineGlobal("AbortController", dom.window.AbortController)
defineGlobal("AbortSignal", dom.window.AbortSignal)
defineGlobal("ResizeObserver", ResizeObserverStub)
defineGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window))

const React = await import("react")
const { createElement } = React
defineGlobal("React", React)
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} = await import("./resizable.tsx")

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

test("ResizableHandle renders caller-provided children", async () => {
  await act(async () => {
    root.render(
      createElement(
        ResizablePanelGroup,
        { direction: "horizontal" },
        createElement(ResizablePanel, null, "Left"),
        createElement(
          ResizableHandle,
          { withHandle: true },
          createElement("span", { "data-testid": "custom-handle" }, "Drag"),
        ),
        createElement(ResizablePanel, null, "Right"),
      ),
    )
  })

  assert.equal(container.querySelectorAll('[data-testid="custom-handle"]').length, 1)
  assert.match(container.textContent ?? "", /Drag/)
})

test("ResizablePanelGroup forwards refs to the primitive group element", async () => {
  const groupRef = React.createRef<React.ElementRef<typeof ResizablePanelGroup>>()

  await act(async () => {
    root.render(
      createElement(
        ResizablePanelGroup,
        { direction: "horizontal", ref: groupRef },
        createElement(ResizablePanel, null, "Left"),
        createElement(ResizableHandle, null),
        createElement(ResizablePanel, null, "Right"),
      ),
    )
  })

  assert.ok(groupRef.current)
})
