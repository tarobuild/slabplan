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
defineGlobal("HTMLHeadingElement", dom.window.HTMLHeadingElement)
defineGlobal("HTMLDivElement", dom.window.HTMLDivElement)
defineGlobal("Node", dom.window.Node)
defineGlobal("Element", dom.window.Element)

const React = await import("react")
const { createElement, createRef } = React
defineGlobal("React", React)
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { AlertDescription, AlertTitle } = await import("./alert.tsx")

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

test("AlertTitle and AlertDescription forward refs to their rendered elements", async () => {
  const titleRef = createRef<HTMLHeadingElement>()
  const descriptionRef = createRef<HTMLDivElement>()

  await act(async () => {
    root.render(
      createElement(
        "div",
        null,
        createElement(AlertTitle, { ref: titleRef }, "Heads up"),
        createElement(AlertDescription, { ref: descriptionRef }, "Details"),
      ),
    )
  })

  assert.equal(titleRef.current?.tagName, "H5")
  assert.equal(titleRef.current instanceof dom.window.HTMLHeadingElement, true)
  assert.equal(descriptionRef.current?.tagName, "DIV")
  assert.equal(descriptionRef.current instanceof dom.window.HTMLDivElement, true)
})
