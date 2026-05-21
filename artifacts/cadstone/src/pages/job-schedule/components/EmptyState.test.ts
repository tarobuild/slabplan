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
defineGlobal("MouseEvent", dom.window.MouseEvent)

const React = await import("react")
const { createElement } = React
defineGlobal("React", React)
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { EmptyState } = await import("./EmptyState.tsx")

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

test("schedule EmptyState renders title and description without an action button by default", async () => {
  await act(async () => {
    root.render(
      createElement(EmptyState, {
        title: "No schedule items",
        description: "Add phases and tasks to start building this job schedule.",
      }),
    )
  })

  assert.match(container.textContent ?? "", /No schedule items/)
  assert.match(container.textContent ?? "", /Add phases and tasks/)
  assert.equal(container.querySelector("button"), null)
})

test("schedule EmptyState renders an action button and invokes onAction", async () => {
  let clicks = 0

  await act(async () => {
    root.render(
      createElement(EmptyState, {
        title: "No baseline",
        description: "Capture the current plan before work starts.",
        actionLabel: "Set Baseline",
        onAction: () => {
          clicks += 1
        },
      }),
    )
  })

  const button = container.querySelector("button")
  assert.equal(button?.textContent, "Set Baseline")

  await act(async () => {
    button?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  })

  assert.equal(clicks, 1)
})
