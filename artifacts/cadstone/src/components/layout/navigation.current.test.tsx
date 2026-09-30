import assert from "node:assert/strict"
import { afterEach, before, beforeEach, describe, test } from "node:test"

import type { AuthUser } from "@/store/auth"
import type { AppRole } from "@/lib/role-access"

import { JSDOM } from "jsdom"

// Renders the real navigation into a DOM and reads which links carry
// aria-current="page". This guards against the router recomputing
// aria-current from `to` and dropping our segment-aware state (admins are
// "in" Clients while viewing /jobs/:id).
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
// JSDOM has no matchMedia; report a wide desktop viewport.
defineGlobal("matchMedia", (query: string) => ({
  matches: true,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
}))
dom.window.matchMedia = globalThis.matchMedia as typeof dom.window.matchMedia

const React = await import("react")
const { createElement } = React
defineGlobal("React", React)
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { MemoryRouter } = await import("react-router-dom")
const { useAuthStore } = await import("@/store/auth")
const { APP_STORAGE_NAMESPACE } = await import("@/lib/brand")
const { TooltipProvider } = await import("@/components/ui/tooltip")
const AppNavigation = (await import("./AppNavigation.tsx")).default
const MobileBottomNav = (await import("./MobileBottomNav.tsx")).default

const JOB_PATH = "/jobs/7f1c2d3e-aaaa-bbbb-cccc-1234567890ab"

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

before(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // Render the desktop column as the icon rail so the embedded job
  // navigator (which loads jobs over the network) stays out of this test.
  dom.window.localStorage.setItem(`${APP_STORAGE_NAMESPACE}:shell:navCollapsed`, "true")
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

function signIn(role: AppRole) {
  const user: AuthUser = {
    id: "nav-test-user",
    email: "nav-test@example.test",
    fullName: "Nav Test",
    role,
    avatarUrl: null,
    phone: null,
  }
  useAuthStore.setState({ user, accessToken: "test-token" })
}

async function render(pathname: string, component: typeof AppNavigation | typeof MobileBottomNav) {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [pathname] },
        createElement(TooltipProvider, null, createElement(component)),
      ),
    )
  })
}

function currentLinks(): string[] {
  return Array.from(container.querySelectorAll('a[aria-current="page"]')).map(
    (link) => link.getAttribute("aria-label") ?? link.textContent?.trim() ?? "",
  )
}

describe("rendered navigation current state", () => {
  test("desktop navigation marks Clients current on an admin job page", async () => {
    signIn("admin")
    await render(`${JOB_PATH}/daily-logs`, AppNavigation)
    assert.deepEqual(currentLinks(), ["Clients"])
  })

  const cases: Array<[AppRole, string, string]> = [
    ["admin", "/dashboard", "Home"],
    ["admin", "/clients/abc", "Clients"],
    ["admin", "/daily-logs", "Daily Logs"],
    ["admin", "/settings/profile", "Settings"],
    ["project_manager", `${JOB_PATH}/schedule`, "My Jobs"],
    ["crew_member", "/daily-logs/mine", "My Daily Logs"],
    ["drafter", "/schedule", "Schedule"],
  ]
  for (const [role, pathname, expected] of cases) {
    test(`desktop navigation marks only ${expected} for ${role} at ${pathname}`, async () => {
      signIn(role)
      await render(pathname, AppNavigation)
      assert.deepEqual(currentLinks(), [expected])
    })
  }

  test("mobile tabs expose the segment-aware current tab", async () => {
    signIn("admin")
    await render(`${JOB_PATH}/files/documents`, MobileBottomNav)
    assert.deepEqual(currentLinks(), ["Clients"])
  })

  test("mobile tabs mark My Jobs for crew inside a job", async () => {
    signIn("crew_member")
    await render(`${JOB_PATH}/daily-logs`, MobileBottomNav)
    assert.deepEqual(currentLinks(), ["My Jobs"])
  })
})
