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

function setViewportWidth(width: number) {
  Object.defineProperty(dom.window, "innerWidth", {
    value: width,
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
defineGlobal("HTMLSelectElement", dom.window.HTMLSelectElement)
defineGlobal("Node", dom.window.Node)
defineGlobal("NodeFilter", dom.window.NodeFilter)
defineGlobal("Element", dom.window.Element)
defineGlobal("CustomEvent", dom.window.CustomEvent)
defineGlobal("MutationObserver", dom.window.MutationObserver)
defineGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window))

dom.window.matchMedia = (query: string) => ({
  media: query,
  matches: dom.window.innerWidth < 768,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() {
    return true
  },
})

const React = await import("react")
const { createElement, useEffect } = React
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { Sidebar, SidebarProvider, useSidebar } = await import("./sidebar.tsx")

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
  for (const portal of Array.from(dom.window.document.body.querySelectorAll("[data-radix-portal]"))) {
    portal.remove()
  }
})

function OpenMobileSidebar() {
  const { setOpenMobile } = useSidebar()

  useEffect(() => {
    setOpenMobile(true)
  }, [setOpenMobile])

  return null
}

test("Sidebar preserves className on desktop container", async () => {
  setViewportWidth(1024)

  await act(async () => {
    root.render(
      createElement(
        SidebarProvider,
        null,
        createElement(
          Sidebar,
          { className: "sentinel-sidebar-class" },
          createElement("div", null, "Desktop content"),
        ),
      ),
    )
  })

  const sidebar = container.querySelector('[data-slot="sidebar-container"]')
  assert.ok(sidebar)
  assert.equal(sidebar.classList.contains("sentinel-sidebar-class"), true)
})

test("Sidebar preserves className on mobile sheet content", async () => {
  setViewportWidth(500)

  await act(async () => {
    root.render(
      createElement(
        SidebarProvider,
        null,
        createElement(OpenMobileSidebar),
        createElement(
          Sidebar,
          { className: "sentinel-sidebar-class" },
          createElement("div", null, "Mobile content"),
        ),
      ),
    )
  })

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  const sidebar = dom.window.document.body.querySelector(
    '[data-slot="sidebar"][data-mobile="true"]',
  )
  assert.ok(sidebar)
  assert.equal(sidebar.classList.contains("sentinel-sidebar-class"), true)
})
