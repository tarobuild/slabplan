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
const { Button } = await import("./button.tsx")

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

test("Button defaults to type=button inside forms", async () => {
  let submits = 0

  await act(async () => {
    root.render(
      createElement(
        "form",
        {
          onSubmit: (event: SubmitEvent) => {
            event.preventDefault()
            submits += 1
          },
        },
        createElement(Button, null, "Open"),
      ),
    )
  })

  const button = container.querySelector("button")
  assert.equal(button?.getAttribute("type"), "button")
  button?.click()
  assert.equal(submits, 0)
})

test("Button still allows explicit submit type", async () => {
  let submits = 0

  await act(async () => {
    root.render(
      createElement(
        "form",
        {
          onSubmit: (event: SubmitEvent) => {
            event.preventDefault()
            submits += 1
          },
        },
        createElement(Button, { type: "submit" }, "Save"),
      ),
    )
  })

  const button = container.querySelector("button")
  assert.equal(button?.getAttribute("type"), "submit")
  button?.click()
  assert.equal(submits, 1)
})

test("Button does not inject a type attribute when rendered asChild", async () => {
  await act(async () => {
    root.render(
      createElement(
        Button,
        { asChild: true },
        createElement("a", { href: "/dashboard" }, "Dashboard"),
      ),
    )
  })

  const link = container.querySelector("a")
  assert.equal(link?.getAttribute("type"), null)
  assert.equal(link?.getAttribute("href"), "/dashboard")
})
