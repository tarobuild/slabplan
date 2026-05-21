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
defineGlobal("Node", dom.window.Node)
defineGlobal("Element", dom.window.Element)
defineGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window))
defineGlobal(
  "ResizeObserver",
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const React = await import("react")
const { createElement } = React
defineGlobal("React", React)
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { Slider } = await import("./slider.tsx")

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

test("Slider passes an accessible name to the thumb", async () => {
  await act(async () => {
    root.render(
      createElement(Slider, {
        value: [50],
        max: 100,
        thumbAriaLabel: "Markup opacity",
      }),
    )
  })

  const thumb = container.querySelector('[role="slider"]')
  assert.equal(thumb?.getAttribute("aria-label"), "Markup opacity")
})
