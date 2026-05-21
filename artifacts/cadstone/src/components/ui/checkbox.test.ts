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
const { Checkbox } = await import("./checkbox.tsx")

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

test("Checkbox renders a check icon for checked state", async () => {
  await act(async () => {
    root.render(createElement(Checkbox, { checked: true }))
  })

  assert.ok(container.querySelector('[data-testid="checkbox-checked-icon"]'))
  assert.equal(container.querySelector('[data-testid="checkbox-indeterminate-icon"]'), null)
})

test("Checkbox renders a distinct minus icon for indeterminate state", async () => {
  await act(async () => {
    root.render(createElement(Checkbox, { checked: "indeterminate" }))
  })

  assert.ok(container.querySelector('[data-testid="checkbox-indeterminate-icon"]'))
  assert.equal(container.querySelector('[data-testid="checkbox-checked-icon"]'), null)
  assert.equal(container.querySelector('[role="checkbox"]')?.getAttribute("data-state"), "indeterminate")
})
