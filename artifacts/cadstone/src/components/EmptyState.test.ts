import assert from "node:assert/strict"
import { afterEach, before, beforeEach, describe, test } from "node:test"

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
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { MemoryRouter } = await import("react-router-dom")
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

describe("EmptyState", () => {
  test("renders href-only actions as navigable links", async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(EmptyState, {
            title: "No jobs yet",
            action: { label: "Create job", href: "/jobs/new" },
            secondaryAction: { label: "View jobs", href: "/jobs" },
          }),
        ),
      )
    })

    const links = Array.from(container.querySelectorAll("a"))
    assert.equal(links.length, 2)
    assert.equal(links[0]?.textContent, "Create job")
    assert.equal(links[0]?.getAttribute("href"), "/jobs/new")
    assert.equal(links[1]?.textContent, "View jobs")
    assert.equal(links[1]?.getAttribute("href"), "/jobs")
    assert.equal(container.querySelectorAll("button").length, 0)
  })
})
