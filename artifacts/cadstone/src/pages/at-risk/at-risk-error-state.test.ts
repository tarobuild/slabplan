import assert from "node:assert/strict"
import { afterEach, before, describe, test } from "node:test"

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
defineGlobal("Element", dom.window.Element)
defineGlobal("Node", dom.window.Node)
defineGlobal("Event", dom.window.Event)
defineGlobal("MouseEvent", dom.window.MouseEvent)
defineGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const React = await import("react")
defineGlobal("React", React)
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { MemoryRouter } = await import("react-router-dom")
const { MissingLogsAtRiskContent } = await import("./MissingLogsPage.tsx")
const { PendingChangeOrdersAtRiskContent } = await import("./PendingChangeOrdersPage.tsx")

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

before(() => {
  window.HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root.unmount()
    })
  }
  container?.remove()
  document.body.innerHTML = ""
})

async function render(element: React.ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root.render(React.createElement(MemoryRouter, null, element))
  })
}

describe("at-risk drilldown error states", () => {
  test("missing logs fetch failure does not render the all-clear empty state", async () => {
    let retries = 0

    await render(
      React.createElement(MissingLogsAtRiskContent, {
        payload: undefined,
        loading: false,
        error: new Error("boom"),
        onRetry: () => {
          retries += 1
        },
      }),
    )

    assert.match(container.textContent ?? "", /couldn't load this at-risk list/i)
    assert.doesNotMatch(container.textContent ?? "", /All open jobs have a recent daily log/i)

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    ) as HTMLButtonElement | undefined
    assert.ok(retry, "Expected retry button")
    retry.click()
    assert.equal(retries, 1)
  })

  test("pending change orders fetch failure does not render the empty success state", async () => {
    await render(
      React.createElement(PendingChangeOrdersAtRiskContent, {
        payload: undefined,
        loading: false,
        error: new Error("boom"),
      }),
    )

    assert.match(container.textContent ?? "", /couldn't load this at-risk list/i)
    assert.doesNotMatch(container.textContent ?? "", /No pending change orders/i)
  })
})
