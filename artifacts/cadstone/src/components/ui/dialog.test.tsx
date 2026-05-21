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
defineGlobal("HTMLInputElement", dom.window.HTMLInputElement)
defineGlobal("HTMLTextAreaElement", dom.window.HTMLTextAreaElement)
defineGlobal("Node", dom.window.Node)
defineGlobal("NodeFilter", dom.window.NodeFilter)
defineGlobal("Element", dom.window.Element)
defineGlobal("DocumentFragment", dom.window.DocumentFragment)
defineGlobal("Event", dom.window.Event)
defineGlobal("CustomEvent", dom.window.CustomEvent)
defineGlobal("KeyboardEvent", dom.window.KeyboardEvent)
defineGlobal("MouseEvent", dom.window.MouseEvent)
defineGlobal("MutationObserver", dom.window.MutationObserver)
defineGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window))

const React = await import("react")
const { createElement } = React
defineGlobal("React", React)
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { Dialog, DialogContent, DialogDescription, DialogTitle } =
  await import("./dialog.tsx")

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

test("DialogContent renders portal content and an accessible close button", async () => {
  await act(async () => {
    root.render(
      createElement(
        Dialog,
        { open: true },
        createElement(
          DialogContent,
          null,
          createElement(DialogTitle, null, "Project details"),
          createElement(DialogDescription, null, "Review the job scope."),
        ),
      ),
    )
  })

  assert.match(dom.window.document.body.textContent ?? "", /Project details/)
  assert.match(dom.window.document.body.textContent ?? "", /Review the job scope/)

  const closeButton = [...dom.window.document.body.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Close",
  )
  assert.ok(closeButton)
})
