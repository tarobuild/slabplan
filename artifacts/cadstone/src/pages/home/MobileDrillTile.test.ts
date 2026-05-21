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

const React = await import("react")
const { createElement } = React
defineGlobal("React", React)
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { MemoryRouter } = await import("react-router-dom")
const { MobileDrillTile } = await import("./MobileDrillTile.tsx")

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

test("MobileDrillTile gives mobile and desktop controls unambiguous test ids", async () => {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(MobileDrillTile, {
          label: "Active jobs",
          value: 4,
          to: "/jobs",
          drillTitle: "Active jobs",
          drillKind: "active-jobs",
          testId: "home-summary-active-jobs",
        }),
      ),
    )
  })

  assert.equal(container.querySelectorAll('[data-testid="home-summary-active-jobs"]').length, 0)
  assert.equal(container.querySelectorAll('[data-testid="home-summary-active-jobs-mobile"]').length, 1)
  assert.equal(container.querySelectorAll('[data-testid="home-summary-active-jobs-desktop"]').length, 1)
})
