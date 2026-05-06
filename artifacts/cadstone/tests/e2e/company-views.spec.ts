import { expect, test } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { CESAR_STATE, WORKER_STATE } from "./helpers/storage"

/**
 * Task #323: Company-wide Schedule (`/schedule`) and Daily Logs
 * (`/daily-logs`) pages for admin/PM. Covers:
 * - GET /schedule and /daily-logs/feed return paginated, hydrated rows
 *   for admin (with jobTitle/clientId/clientName attached).
 * - Cursor and page pagination shapes are returned correctly.
 * - Crew member is gated out (403) at the API layer.
 * - Frontend route gating: admin sees the pages and view-switcher /
 *   filter chips; URL filters persist; crew is redirected away.
 */

test.describe("company-wide schedule & daily logs (admin)", () => {
  test.use({ storageState: CESAR_STATE })

  test("GET /schedule returns hydrated rows with client/job context", async ({ request }) => {
    const { accessToken } = await loginViaApi(request, CESAR)
    const res = await request.get("/api/schedule?limit=5", {
      headers: authHeaders(accessToken),
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.pagination).toBeTruthy()
    // page mode default
    expect(body.pagination).toHaveProperty("totalItems")
    if (body.data.length > 0) {
      const first = body.data[0]
      expect(first).toHaveProperty("id")
      expect(first).toHaveProperty("title")
      // hydrated context attached by the company endpoint
      expect(first).toHaveProperty("jobTitle")
      expect(first).toHaveProperty("clientId")
      expect(first).toHaveProperty("clientName")
    }
  })

  test("GET /schedule supports cursor pagination", async ({ request }) => {
    const { accessToken } = await loginViaApi(request, CESAR)
    const res = await request.get("/api/schedule?cursor=&limit=2", {
      headers: authHeaders(accessToken),
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.pagination).toMatchObject({ limit: 2 })
    expect(body.pagination).toHaveProperty("hasMore")
    expect(body.pagination).toHaveProperty("nextCursor")
  })

  test("GET /daily-logs/feed returns hydrated rows", async ({ request }) => {
    const { accessToken } = await loginViaApi(request, CESAR)
    const res = await request.get("/api/daily-logs/feed?limit=5", {
      headers: authHeaders(accessToken),
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.logs)).toBe(true)
    if (body.logs.length > 0) {
      const first = body.logs[0]
      expect(first).toHaveProperty("id")
      expect(first).toHaveProperty("jobTitle")
      expect(first).toHaveProperty("clientId")
      expect(first).toHaveProperty("clientName")
      expect(first).toHaveProperty("status")
    }
  })

  test("GET /daily-logs/feed supports cursor pagination", async ({ request }) => {
    const { accessToken } = await loginViaApi(request, CESAR)
    const res = await request.get("/api/daily-logs/feed?cursor=&limit=2", {
      headers: authHeaders(accessToken),
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.pagination).toMatchObject({ limit: 2 })
    expect(body.pagination).toHaveProperty("hasMore")
    expect(body.pagination).toHaveProperty("nextCursor")
  })

  test("admin sees Schedule page, gantt by default, view switch persists in URL", async ({ page }) => {
    await page.goto("/schedule")
    await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible()
    const switcher = page.getByTestId("schedule-view-switcher")
    await expect(switcher).toBeVisible()
    // Default view is Gantt.
    await expect(switcher.getByRole("tab", { name: "Gantt" })).toHaveAttribute(
      "data-state",
      "active",
    )

    // Switch to list view — URL should persist the choice.
    await page.getByRole("tab", { name: "List" }).click()
    await expect(page).toHaveURL(/[?&]view=list\b/)

    // Filter chip from URL renders and can be cleared.
    await page.goto("/schedule?status=overdue")
    const chip = page.getByTestId("filter-chip-status")
    await expect(chip).toBeVisible()
    await chip.getByRole("button", { name: /clear status filter/i }).click()
    await expect(page).not.toHaveURL(/status=overdue/)
  })

  test("admin Schedule page exposes filter controls (client/job/assignee/status/date)", async ({ page }) => {
    await page.goto("/schedule")
    const filters = page.getByTestId("schedule-filters")
    await expect(filters).toBeVisible()
    await expect(page.getByTestId("filter-select-clientId")).toBeVisible()
    await expect(page.getByTestId("filter-select-jobId")).toBeVisible()
    await expect(page.getByTestId("filter-select-assigneeId")).toBeVisible()
    await expect(page.getByTestId("filter-select-status")).toBeVisible()
    await expect(page.getByTestId("filter-input-from")).toBeVisible()
    await expect(page.getByTestId("filter-input-to")).toBeVisible()
  })

  test("invalid /schedule cursor returns a clean 400, not a DB error", async ({ request }) => {
    const { accessToken } = await loginViaApi(request, CESAR)
    // base64url-encoded JSON cursor with a non-UUID id.
    const payload = Buffer.from(
      JSON.stringify({ v: 1, k: ["2026-01-01"], id: "not-a-uuid" }),
    ).toString("base64url")
    const res = await request.get(`/api/schedule?cursor=${payload}&limit=2`, {
      headers: authHeaders(accessToken),
    })
    expect(res.status()).toBe(400)
  })

  test("admin sees Daily Logs feed page with search and filter controls", async ({ page }) => {
    await page.goto("/daily-logs")
    await expect(page.getByRole("heading", { name: "Daily Logs" })).toBeVisible()
    const search = page.getByTestId("daily-logs-search-input")
    await expect(search).toBeVisible()
    await search.fill("site")
    await expect(page).toHaveURL(/keywords=site/, { timeout: 2000 })

    // Required filter controls are present.
    const filters = page.getByTestId("daily-logs-filters")
    await expect(filters).toBeVisible()
    await expect(page.getByTestId("filter-select-clientId")).toBeVisible()
    await expect(page.getByTestId("filter-select-jobId")).toBeVisible()
    await expect(page.getByTestId("filter-select-createdBy")).toBeVisible()
    await expect(page.getByTestId("filter-input-from")).toBeVisible()
    await expect(page.getByTestId("filter-input-to")).toBeVisible()
    await expect(page.getByTestId("filter-check-hasAttachments")).toBeVisible()
    await expect(page.getByTestId("filter-check-hasComments")).toBeVisible()
  })

  test("admin top nav exposes Schedule and Daily Logs links", async ({ page }) => {
    await page.goto("/dashboard")
    await expect(page.getByRole("link", { name: "Schedule", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Daily Logs", exact: true })).toBeVisible()
  })
})

test.describe("company-wide schedule & daily logs (crew gated)", () => {
  test.use({ storageState: WORKER_STATE })

  test("worker GET /schedule returns 403", async ({ request }) => {
    const workerCreds = (await import("./helpers/auth")).getWorkerCredentials()
    const { accessToken } = await loginViaApi(request, workerCreds)
    const res = await request.get("/api/schedule", {
      headers: authHeaders(accessToken),
    })
    expect(res.status()).toBe(403)
  })

  test("worker GET /daily-logs/feed returns 403", async ({ request }) => {
    const workerCreds = (await import("./helpers/auth")).getWorkerCredentials()
    const { accessToken } = await loginViaApi(request, workerCreds)
    const res = await request.get("/api/daily-logs/feed", {
      headers: authHeaders(accessToken),
    })
    expect(res.status()).toBe(403)
  })

  test("worker hitting /schedule is redirected to /403", async ({ page }) => {
    await page.goto("/schedule")
    await page.waitForURL(/\/403\b/)
    await expect(page).toHaveURL(/\/403\b/)
  })

  test("worker hitting /daily-logs is redirected to /403", async ({ page }) => {
    await page.goto("/daily-logs")
    await page.waitForURL(/\/403\b/)
    await expect(page).toHaveURL(/\/403\b/)
  })

  test("worker top nav hides Schedule and Daily Logs links", async ({ page }) => {
    await page.goto("/dashboard")
    await expect(
      page.getByRole("link", { name: "Schedule", exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("link", { name: "Daily Logs", exact: true }),
    ).toHaveCount(0)
  })
})
