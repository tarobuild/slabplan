import assert from "node:assert/strict"
import { afterEach, before, beforeEach, describe, test } from "node:test"

// Type-only imports are erased at build time and don't pull in any runtime
// code, so they are safe to declare ahead of the JSDOM bootstrap below.
import type { AuthUser } from "@/store/auth"
import type { AppRole } from "@/lib/role-access"

import { JSDOM } from "jsdom"

// Set up a real DOM before importing anything that touches React/router so
// React's client renderer + react-router's effects can run normally.
const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
})

// Some globals (like `navigator`) are getter-only on the Node 24 globalThis,
// so we install everything via Object.defineProperty with `configurable: true`
// to bypass that restriction.
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

// React 18's act() is exposed on `react`. We have to load React after the DOM
// is in place so its module-level setup picks up the browser-like environment.
const React = await import("react")
const { createElement } = React
// react-dom/test-utils' act flushes effects under act(); React 18 also
// re-exports it via `react`.
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { MemoryRouter, Route, Routes } = await import("react-router-dom")

const RoleGateModule = await import("./RoleGate.tsx")
const RoleGate = RoleGateModule.default

const { useAuthStore } = await import("@/store/auth")

const ALLOW_MANAGER_OR_ABOVE = ["admin", "project_manager"] as const

function setRole(role: AppRole | null) {
  if (role === null) {
    useAuthStore.setState({ user: null, accessToken: null })
    return
  }

  const user: AuthUser = {
    id: "user-1",
    email: "test@example.com",
    fullName: "Test User",
    role,
    avatarUrl: null,
    phone: null,
  }

  useAuthStore.setState({ user, accessToken: "test-token" })
}

const PROTECTED_MARKER = "PROTECTED_SALES"
const DASHBOARD_MARKER = "DASHBOARD_LANDING"
const FORBIDDEN_MARKER = "FORBIDDEN_LANDING"

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

before(() => {
  // React 18 logs a warning if IS_REACT_ACT_ENVIRONMENT isn't set when act() runs.
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
  setRole(null)
})

// Renders the same nesting App.tsx uses: a parent <Route element={<RoleGate />}>
// wraps the protected child route. We also include sibling /dashboard and
// /403 sentinel routes so we can assert the actual landing page after a
// redirect — not just the absence of the protected content.
async function renderRoutePattern(initialPath: string, redirectTo?: string) {
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
            {
              element: createElement(RoleGate, {
                allow: ALLOW_MANAGER_OR_ABOVE,
                ...(redirectTo ? { redirectTo } : {}),
              }),
            },
            createElement(Route, {
              path: "/sales",
              element: createElement("div", null, PROTECTED_MARKER),
            }),
          ),
          createElement(Route, {
            path: "/dashboard",
            element: createElement("div", null, DASHBOARD_MARKER),
          }),
          createElement(Route, {
            path: "/403",
            element: createElement("div", null, FORBIDDEN_MARKER),
          }),
        ),
      ),
    )
  })
}

describe("<RoleGate /> route-element pattern (matches App.tsx usage)", () => {
  test("admin: renders the protected child route via <Outlet />", async () => {
    setRole("admin")
    await renderRoutePattern("/sales")
    assert.match(container.textContent ?? "", new RegExp(PROTECTED_MARKER))
    assert.doesNotMatch(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
  })

  test("project_manager: renders the protected child route via <Outlet />", async () => {
    setRole("project_manager")
    await renderRoutePattern("/sales")
    assert.match(container.textContent ?? "", new RegExp(PROTECTED_MARKER))
    assert.doesNotMatch(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
  })

  test("crew_member: redirects to /dashboard (default redirectTo)", async () => {
    setRole("crew_member")
    await renderRoutePattern("/sales")
    assert.doesNotMatch(container.textContent ?? "", new RegExp(PROTECTED_MARKER))
    assert.match(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
  })

  test("signed-out (no user): redirects to /dashboard", async () => {
    setRole(null)
    await renderRoutePattern("/sales")
    assert.doesNotMatch(container.textContent ?? "", new RegExp(PROTECTED_MARKER))
    assert.match(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
  })

  test("crew_member: honors a custom redirectTo prop", async () => {
    setRole("crew_member")
    await renderRoutePattern("/sales", "/403")
    assert.doesNotMatch(container.textContent ?? "", new RegExp(PROTECTED_MARKER))
    assert.match(container.textContent ?? "", new RegExp(FORBIDDEN_MARKER))
  })
})

describe("<RoleGate /> children pattern", () => {
  async function renderChildren(role: AppRole | null) {
    setRole(role)
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/sales"] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: "/sales",
              element: createElement(
                RoleGate,
                { allow: ALLOW_MANAGER_OR_ABOVE },
                createElement("span", null, "INLINE_CHILD"),
              ),
            }),
            createElement(Route, {
              path: "/dashboard",
              element: createElement("div", null, DASHBOARD_MARKER),
            }),
          ),
        ),
      )
    })
  }

  test("admin: renders the wrapped children inline", async () => {
    await renderChildren("admin")
    assert.match(container.textContent ?? "", /INLINE_CHILD/)
    assert.doesNotMatch(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
  })

  test("project_manager: renders the wrapped children inline", async () => {
    await renderChildren("project_manager")
    assert.match(container.textContent ?? "", /INLINE_CHILD/)
    assert.doesNotMatch(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
  })

  test("crew_member: redirects to /dashboard instead of rendering children", async () => {
    await renderChildren("crew_member")
    assert.doesNotMatch(container.textContent ?? "", /INLINE_CHILD/)
    assert.match(container.textContent ?? "", new RegExp(DASHBOARD_MARKER))
  })
})
