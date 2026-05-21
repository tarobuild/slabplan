import assert from "node:assert/strict"
import { afterEach, before, beforeEach, describe, test } from "node:test"

import type { AuthUser } from "@/store/auth"
import type { AppRole } from "@/lib/role-access"

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
const AdminRouteModule = await import("./AdminRoute.tsx")
const AdminRoute = AdminRouteModule.default
const { useAuthStore } = await import("@/store/auth")

const TEAM_MARKER = "SETTINGS_TEAM"
const FORBIDDEN_MARKER = "FORBIDDEN_PAGE"

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
  useAuthStore.setState({ user: null, accessToken: null })
})

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

async function renderAdminRoute() {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/settings/team"] },
        createElement(
          Routes,
          null,
          createElement(
            Route,
            { element: createElement(AdminRoute) },
            createElement(Route, {
              path: "/settings/team",
              element: createElement("div", null, TEAM_MARKER),
            }),
          ),
          createElement(Route, {
            path: "/403",
            element: createElement("div", null, FORBIDDEN_MARKER),
          }),
        ),
      ),
    )
  })
}

describe("<AdminRoute />", () => {
  test("renders the protected child route for admins", async () => {
    setRole("admin")

    await renderAdminRoute()

    assert.match(container.textContent ?? "", new RegExp(TEAM_MARKER))
    assert.doesNotMatch(container.textContent ?? "", new RegExp(FORBIDDEN_MARKER))
  })

  test("redirects project managers to /403", async () => {
    setRole("project_manager")

    await renderAdminRoute()

    assert.match(container.textContent ?? "", new RegExp(FORBIDDEN_MARKER))
    assert.doesNotMatch(container.textContent ?? "", new RegExp(TEAM_MARKER))
  })

  test("redirects crew members to /403", async () => {
    setRole("crew_member")

    await renderAdminRoute()

    assert.match(container.textContent ?? "", new RegExp(FORBIDDEN_MARKER))
    assert.doesNotMatch(container.textContent ?? "", new RegExp(TEAM_MARKER))
  })

  test("redirects a null user to /403 under the protected-route assumption", async () => {
    setRole(null)

    await renderAdminRoute()

    assert.match(container.textContent ?? "", new RegExp(FORBIDDEN_MARKER))
    assert.doesNotMatch(container.textContent ?? "", new RegExp(TEAM_MARKER))
  })
})
