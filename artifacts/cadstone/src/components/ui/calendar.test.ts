import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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
const { Calendar } = await import("./calendar.tsx")

const source = readFileSync(new URL("./calendar.tsx", import.meta.url), "utf8")

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

test("Calendar applies month grid classes to the DayPicker grid", async () => {
  await act(async () => {
    root.render(createElement(Calendar, { month: new Date(2026, 0, 1) }))
  })

  const grid = container.querySelector('[role="grid"]')
  assert.ok(grid)
  assert.match(grid.className, /w-full/)
  assert.match(grid.className, /border-collapse/)
})

test("Calendar renders week number overrides as row headers", () => {
  assert.match(
    source,
    /WeekNumber: \(\{ children, \.\.\.props \}\) => \{[\s\S]*<th \{\.\.\.props\}>[\s\S]*size-\[--cell-size\][\s\S]*<\/th>/,
  )
  assert.doesNotMatch(source, /WeekNumber: \(\{ children, \.\.\.props \}\) => \{[\s\S]*<td \{\.\.\.props\}>/)
})
