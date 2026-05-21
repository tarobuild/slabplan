import assert from "node:assert/strict"
import { afterEach, before, beforeEach, describe, test } from "node:test"

import type { AuthUser } from "@/store/auth"

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
const { MemoryRouter, Route, Routes } = await import("react-router-dom")
const { useAuthStore } = await import("@/store/auth")
const { PublicOnlyRoute } = await import("./App.tsx")

const REGISTER_MARKER = "REGISTER_PAGE"
const ACCEPT_INVITE_MARKER = "ACCEPT_INVITE_PAGE"
const DASHBOARD_MARKER = "DASHBOARD_PAGE"

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
  useAuthStore.getState().clearAuth()
})

function setAuthenticatedUser() {
  const user: AuthUser = {
    id: "user-1",
    email: "test@example.com",
    fullName: "Test User",
    role: "admin",
    avatarUrl: null,
    phone: null,
  }

  useAuthStore.getState().setAuth(user, "test-token")
}

async function renderPublicRoute(ready: boolean, initialPath = "/register") {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [initialPath] },
        createElement(
          Routes,
          null,
          createElement(
            Route,
            { element: createElement(PublicOnlyRoute, { ready }) },
            createElement(Route, {
              path: "/register",
              element: createElement("div", null, REGISTER_MARKER),
            }),
            createElement(Route, {
              path: "/accept-invite",
              element: createElement("div", null, ACCEPT_INVITE_MARKER),
            }),
          ),
          createElement(Route, {
            path: "/dashboard",
            element: createElement("div", null, DASHBOARD_MARKER),
          }),
        ),
      ),
    )
  })
}

describe("/register public-only routing", () => {
  test("renders the register route for signed-out users after auth is ready", async () => {
    await renderPublicRoute(true)

    assert.match(container.textContent ?? "", new RegExp(REGISTER_MARKER))
    assert.doesNotMatch(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
  })

  test("redirects authenticated users to the dashboard", async () => {
    setAuthenticatedUser()

    await renderPublicRoute(true)

    assert.match(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
    assert.doesNotMatch(container.textContent ?? "", new RegExp(REGISTER_MARKER))
  })

  test("shows the session restore state before auth is ready", async () => {
    await renderPublicRoute(false)

    assert.match(container.textContent ?? "", /Restoring your session/)
    assert.doesNotMatch(container.textContent ?? "", new RegExp(REGISTER_MARKER))
    assert.doesNotMatch(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
  })
})

describe("/accept-invite public-only routing", () => {
  test("keeps token invite links reachable for signed-out users", async () => {
    await renderPublicRoute(true, "/accept-invite?token=test-token")

    assert.match(container.textContent ?? "", new RegExp(ACCEPT_INVITE_MARKER))
    assert.doesNotMatch(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
  })

  test("redirects authenticated users away from invite activation", async () => {
    setAuthenticatedUser()

    await renderPublicRoute(true, "/accept-invite?token=test-token")

    assert.match(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
    assert.doesNotMatch(container.textContent ?? "", new RegExp(ACCEPT_INVITE_MARKER))
  })
})
