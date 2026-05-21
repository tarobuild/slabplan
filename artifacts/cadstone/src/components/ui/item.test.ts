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
defineGlobal("React", React)
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { Item, ItemGroup } = await import("./item.tsx")

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

test("ItemGroup exposes list semantics with listitem children", async () => {
  await act(async () => {
    root.render(
      createElement(
        ItemGroup,
        null,
        createElement(Item, null, "One"),
        createElement(Item, null, "Two"),
      ),
    )
  })

  const list = container.querySelector('[role="list"]')
  assert.ok(list)
  assert.equal(list.querySelectorAll('[role="listitem"]').length, 2)
})

test("Item does not force listitem semantics onto asChild content", async () => {
  await act(async () => {
    root.render(
      createElement(
        Item,
        { asChild: true },
        createElement("button", { type: "button" }, "Action"),
      ),
    )
  })

  const button = container.querySelector("button")
  assert.equal(button?.getAttribute("role"), null)
})
