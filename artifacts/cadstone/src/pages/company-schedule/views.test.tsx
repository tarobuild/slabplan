import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import { JSDOM } from "jsdom"
import type { AuthUser } from "@/store/auth"
import type { ScheduleRow } from "./layout"

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/", pretendToBeVisual: true,
})
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DocumentFragment", "CustomEvent", "MutationObserver"] as const) {
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? dom.window : dom.window[name],
    configurable: true, writable: true,
  })
}
Object.defineProperty(globalThis, "getComputedStyle", {
  value: dom.window.getComputedStyle.bind(dom.window), configurable: true,
})
const React = await import("react")
Object.defineProperty(globalThis, "React", { value: React, configurable: true })
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const { act, createElement } = React
const { createRoot } = await import("react-dom/client")
const { MemoryRouter } = await import("react-router-dom")
const { api } = await import("@/lib/api")
const { useAuthStore } = await import("@/store/auth")
const CompanySchedulePage = (await import("../schedule.tsx")).default
const originalGet = api.get
const requests: Array<Record<string, string | number>> = []
const optionRequests: Array<{ url: string; params?: Record<string, string | number> }> = []
let optionPageCount = 1
let failOptionRequest = false
const item = {
  id: "item-1", jobId: "job-1", jobTitle: "TEST - Kitchen",
  clientName: "TEST - Studio", title: "TEST - Slab approval",
  startDate: "2026-09-28", endDate: "2026-10-01",
  isComplete: false, displayColor: "#2563eb", progress: 25,
} as ScheduleRow
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  requests.length = 0
  optionRequests.length = 0
  optionPageCount = 1
  failOptionRequest = false
  api.get = (async (url: string, config?: { params?: Record<string, string | number> }) => {
    if (url === "/schedule") {
      requests.push({ ...config?.params })
      return { data: { data: [item], pagination: { hasMore: false, nextCursor: null, limit: 50 } } }
    }
    optionRequests.push({ url, params: { ...config?.params } })
    if (failOptionRequest) throw new Error("TEST - Reference data unavailable")
    const page = config?.params?.page ?? 1
    return { data: {
      clients: [{ id: `client-${page}`, companyName: "TEST - Studio" }],
      jobs: [{ id: `job-${page}`, clientId: `client-${page}`, clientName: "TEST - Studio", title: "TEST - Kitchen" }],
      users: [{ id: `user-${page}`, fullName: "TEST - Admin", email: "test@example.test" }],
      pagination: { totalPages: optionPageCount },
    } }
  }) as typeof api.get
  const user: AuthUser = {
    id: "test-user", email: "test@example.test", fullName: "TEST - Admin",
    role: "admin", avatarUrl: null, phone: null,
  }
  useAuthStore.setState({ user, accessToken: "test-token" })
  container = dom.window.document.createElement("div")
  dom.window.document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  api.get = originalGet
  useAuthStore.setState({ user: null, accessToken: null })
})

async function render(view: string, role = "admin") {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, role } })
  await act(async () => {
    root.render(createElement(MemoryRouter, {
      initialEntries: [`/schedule?view=${view}&date=2026-09-30&clientId=client-1`],
    }, createElement(CompanySchedulePage)))
  })
}

for (const mode of ["gantt", "week", "month", "list"]) {
  test(`${mode} renders its real, distinct schedule view and preserves filtering`, async () => {
    await render(mode)
    assert.ok(container.querySelector(`[data-testid='schedule-${mode}']`))
    assert.equal(container.querySelector(`[role='tab'][data-state='active']`)?.textContent, mode[0].toUpperCase() + mode.slice(1))
    assert.equal(requests.at(-1)?.clientId, "client-1")
    assert.equal(requests.at(-1)?.cursor, "")
    if (mode === "list") assert.equal(requests.at(-1)?.from, undefined)
    else assert.ok(requests.at(-1)?.from && requests.at(-1)?.to)
  })
}

test("changing view through the visible tab switches the rendered component", async () => {
  await render("week")
  const monthTab = container.querySelector<HTMLButtonElement>("[role='tab'][id$='trigger-month']")!
  await act(async () => {
    monthTab.dispatchEvent(new dom.window.MouseEvent("mousedown", { button: 0, bubbles: true }))
  })
  assert.ok(container.querySelector("[data-testid='schedule-month-grid']"))
  assert.equal(container.querySelector("[data-testid='schedule-week']"), null)
  assert.equal(requests.at(-1)?.clientId, "client-1")
  assert.equal(requests.at(-1)?.from, "2026-08-30")
})

test("schedule filter labels name their controls and date fields fit narrow screens", async () => {
  await render("week")
  assert.ok(container.querySelector("[data-testid='schedule-filters']")?.classList.contains("lg:grid-cols-3"))
  assert.ok(container.querySelector("[data-testid='schedule-filters']")?.classList.contains("xl:grid-cols-6"))
  const labels = Array.from(container.querySelectorAll<HTMLLabelElement>("label"))
  for (const name of ["Client", "Job", "Assignee", "Status", "From", "To"]) {
    const label = labels.find((element) => element.textContent === name)!
    assert.ok(label.htmlFor)
    const control = container.querySelector(`#${label.htmlFor}`)!
    assert.ok(control)
    if (name === "From" || name === "To") {
      assert.ok(control.parentElement?.classList.contains("col-span-2"))
      assert.ok(control.parentElement?.classList.contains("min-[360px]:col-span-1"))
    }
  }
})

test("filter option requests use valid sizes and load every page", async () => {
  optionPageCount = 2
  await render("week")
  for (const url of ["/clients", "/jobs", "/users"]) {
    assert.deepEqual(optionRequests.filter((request) => request.url === url).map((request) => request.params?.page), [1, 2])
  }
  assert.equal(optionRequests.find((request) => request.url === "/clients")?.params?.pageSize, 100)
  assert.equal(optionRequests.find((request) => request.url === "/jobs")?.params?.pageSize, 100)
  assert.ok(container.querySelector("[data-testid='filter-chip-clientId']")?.textContent?.includes("TEST - Studio"))
})

test("drafter reference filters use only assigned-job data and avoid restricted lists", async () => {
  await render("week", "drafter")
  assert.deepEqual(optionRequests.map((request) => request.url), ["/jobs"])
  assert.equal(container.querySelector("#schedule-filter-assignee"), null)
  assert.ok(container.querySelector("[data-testid='filter-chip-clientId']")?.textContent?.includes("TEST - Studio"))
})

test("reference filter failures are visible without hiding a usable schedule", async () => {
  failOptionRequest = true
  await render("week")
  assert.ok(container.querySelector("[role='status']")?.textContent?.includes("filters could not be loaded"))
  assert.ok(container.querySelector("[data-testid='schedule-week']"))
})

test("Gantt scale selection changes geometry and range while preserving filters", async () => {
  await render("gantt")
  const scaleControl = container.querySelector("[data-testid='gantt-scale-control']")!
  for (const [scale, from, to, headings] of [
    ["week", "2026-09-13", "2026-12-05", 12],
    ["month", "2026-08-01", "2027-07-31", 12],
    ["year", "2025-01-01", "2027-12-31", 36],
    ["day", "2026-09-20", "2026-10-24", 35],
  ] as const) {
    await act(async () => {
      scaleControl.querySelector<HTMLButtonElement>(`[role='tab'][id$='trigger-${scale}']`)!
        .dispatchEvent(new dom.window.MouseEvent("mousedown", { button: 0, bubbles: true }))
    })
    assert.equal(container.querySelector("[data-testid='schedule-gantt']")?.getAttribute("data-scale"), scale)
    assert.equal(container.querySelector("[data-testid='gantt-scale-headings']")?.children.length, headings)
    assert.equal(requests.at(-1)?.from, from)
    assert.equal(requests.at(-1)?.to, to)
    assert.equal(requests.at(-1)?.clientId, "client-1")
  }
})

test("Gantt scale survives view changes, date navigation and clearing filters", async () => {
  await render("gantt&scale=month")
  await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='Next period']")!.click())
  assert.equal(requests.at(-1)?.from, "2027-07-01")
  const tabs = container.querySelector("[data-testid='schedule-view-switcher']")!
  for (const view of ["week", "gantt"]) {
    await act(async () => tabs.querySelector<HTMLButtonElement>(`[id$='trigger-${view}']`)!
      .dispatchEvent(new dom.window.MouseEvent("mousedown", { button: 0, bubbles: true })))
  }
  assert.equal(container.querySelector("[data-testid='schedule-gantt']")?.getAttribute("data-scale"), "month")
  const clear = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Clear all")!
  await act(async () => clear.click())
  assert.equal(requests.at(-1)?.clientId, undefined)
  assert.equal(requests.at(-1)?.from, "2027-07-01")
  assert.equal(container.querySelector("[data-testid='schedule-gantt']")?.getAttribute("data-scale"), "month")
})

for (const mode of ["gantt", "week", "month", "list"]) {
  test(`${mode} does not add job navigation for drafters`, async () => {
    await render(mode, "drafter")
    assert.equal(container.querySelectorAll("a[href^='/jobs/']").length, 0)
    assert.ok(container.textContent?.includes(item.title))
  })
}

test("period navigation updates dates without clearing the client filter", async () => {
  await render("week")
  await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='Next week']")!.click())
  assert.equal(requests.at(-1)?.from, "2026-10-04")
  assert.equal(requests.at(-1)?.to, "2026-10-10")
  assert.equal(requests.at(-1)?.clientId, "client-1")
})

test("phone month-day selection updates its agenda", async () => {
  await render("month")
  const compact = container.querySelector("[data-testid='schedule-month-compact']")!
  const nextDay = compact.querySelector<HTMLButtonElement>("button[aria-label^='Thursday, Oct 1']")!
  await act(async () => nextDay.click())
  assert.equal(nextDay.getAttribute("aria-pressed"), "true")
  assert.ok(compact.querySelector("section")?.textContent?.includes("Thursday, Oct 1"))
  assert.ok(compact.querySelector("section")?.textContent?.includes(item.title))
})
