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

const React = await import("react")
const { createElement } = React
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { Progress, progressPercent } = await import("./progress.tsx")

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

test("Progress computes visual width from value relative to max", async () => {
  await act(async () => {
    root.render(createElement(Progress, { value: 100, max: 200 }))
  })

  const progress = container.querySelector('[role="progressbar"]')
  assert.ok(progress)
  assert.equal(progress.getAttribute("aria-valuemax"), "200")
  assert.equal(progress.getAttribute("aria-valuenow"), "100")
  assert.equal(
    (progress.firstElementChild as HTMLElement | null)?.style.transform,
    "translateX(-50%)",
  )
})

test("progressPercent clamps invalid and out-of-range values", () => {
  assert.equal(progressPercent(250, 200), 100)
  assert.equal(progressPercent(-10, 200), 0)
  assert.equal(progressPercent(50, 0), 50)
  assert.equal(progressPercent(null, 200), 0)
})
