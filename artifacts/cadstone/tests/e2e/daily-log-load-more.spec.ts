import { expect, test, type Request } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { createTestJob, deleteJob, pickAnyClient } from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

test.use({ storageState: CESAR_STATE })

/**
 * Regression suite for the per-job Daily Logs "Load more" flow.
 *
 * The page switched from page-mode (`?page=&pageSize=`) to cursor mode
 * (`?cursor=&limit=25`). These tests pin that contract so a future
 * change can't silently slip back to page-mode or break the cursor
 * reset on filter change.
 */
test.describe("daily logs Load more (cursor pagination)", () => {
  let token = ""
  let jobId = ""
  const createdLogIds: string[] = []
  const stamp = Date.now()
  const jobTitle = `E2E load-more job ${stamp}`
  // Seed 28 logs so the first cursor page (limit=25) leaves a remainder
  // that triggers the "Load more" button.
  const seededLogCount = 28
  // Two distinct keyword markers — one in the first 25 (newest) seeded
  // logs, one in the tail. We use the tail marker to drive the
  // filter-reset assertion so the result set on its own does NOT need
  // a second page; we want to assert the cursor query string resets,
  // not that the filter still paginates.
  const filterMarker = `tailmark-${stamp}`

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken

    const clientId = await pickAnyClient(request, token)
    test.skip(
      !clientId,
      "Need at least one client to attach a fresh test job to",
    )

    jobId = await createTestJob(request, token, {
      title: jobTitle,
      clientId: clientId!,
    })

    // logDate is the leading sort key (DESC). Seed across 28 distinct
    // dates so order is stable and dates shift by index — tailmark is
    // applied to the OLDEST log so it deliberately sits past the first
    // cursor page (the page size is 25 ordered DESC).
    for (let i = 0; i < seededLogCount; i += 1) {
      const day = new Date(2025, 0, i + 1) // 2025-01-01 .. 2025-01-28
      const isoDate = day.toISOString().slice(0, 10)
      const isTailMarker = i === 0 // oldest by date → last by DESC sort
      const res = await request.post(`/api/jobs/${jobId}/daily-logs`, {
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        data: {
          logDate: isoDate,
          title: `E2E load-more log ${i}`,
          notes: isTailMarker
            ? `seed log ${i} ${filterMarker}`
            : `seed log ${i}`,
        },
      })
      expect(
        res.ok(),
        `daily-log create failed at i=${i}: ${res.status()} ${await res.text()}`,
      ).toBeTruthy()
      const body = await res.json()
      const id = body.log?.id ?? body.dailyLog?.id ?? body.id
      expect(id, `seeded log ${i} must come back with an id`).toBeTruthy()
      createdLogIds.push(id)
    }
  })

  test.afterAll(async ({ request }) => {
    for (const id of createdLogIds) {
      await request.delete(`/api/daily-logs/${id}`, {
        headers: authHeaders(token),
      })
    }
    if (jobId) {
      await deleteJob(request, token, jobId)
    }
  })

  test("opens in cursor mode, paginates with Load more, and resets cursor on filter change", async ({
    page,
  }) => {
    // Buffer every GET against the daily-logs endpoint so we can replay
    // the URLs in assertions. Order matters: subscribe BEFORE goto().
    const dailyLogRequests: URL[] = []
    page.on("request", (req: Request) => {
      const url = req.url()
      // Match both absolute (e.g. http://localhost:.../api/...) and
      // relative paths under the dev base URL.
      if (
        req.method() === "GET" &&
        url.includes(`/api/jobs/${jobId}/daily-logs`)
      ) {
        dailyLogRequests.push(new URL(url))
      }
    })

    await page.goto(`/jobs/${jobId}/daily-logs`)

    // Wait for the initial cursor request to land. The page issues
    // `?cursor=&limit=25` on first load. Polling the buffer keeps the
    // assertion deterministic across slow CI runs.
    await expect
      .poll(() => dailyLogRequests.length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)

    const firstUrl = dailyLogRequests[0]!
    // Contract: cursor mode only. Page-mode keys must NEVER appear.
    expect(firstUrl.searchParams.has("cursor")).toBe(true)
    expect(firstUrl.searchParams.get("cursor")).toBe("")
    expect(firstUrl.searchParams.get("limit")).toBe("25")
    expect(firstUrl.searchParams.has("page")).toBe(false)
    expect(firstUrl.searchParams.has("pageSize")).toBe(false)

    // The "Load more" button only renders when hasMore=true. With 28
    // seeded logs that is the case on the first page.
    const loadMoreButton = page.getByRole("button", { name: /load more/i })
    await expect(loadMoreButton).toBeVisible({ timeout: 15_000 })

    const requestsBeforeLoadMore = dailyLogRequests.length
    // Capture the second daily-logs request synchronously around the
    // click so we don't race the buffer.
    const [loadMoreRequest] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.method() === "GET" &&
          req.url().includes(`/api/jobs/${jobId}/daily-logs`),
      ),
      loadMoreButton.click(),
    ])

    const loadMoreUrl = new URL(loadMoreRequest.url())
    expect(loadMoreUrl.searchParams.has("cursor")).toBe(true)
    const loadMoreCursor = loadMoreUrl.searchParams.get("cursor") ?? ""
    expect(
      loadMoreCursor.length,
      "Load more must send a non-empty cursor token",
    ).toBeGreaterThan(0)
    // Still no page-mode keys.
    expect(loadMoreUrl.searchParams.has("page")).toBe(false)
    expect(loadMoreUrl.searchParams.has("pageSize")).toBe(false)
    expect(loadMoreUrl.searchParams.get("limit")).toBe("25")

    // After Load more lands, the appended batch must include the
    // tail-marker note (it lives on the OLDEST log, so it lives in the
    // second page).
    await expect(page.getByText(filterMarker).first()).toBeVisible({
      timeout: 15_000,
    })

    // Snapshot how many requests we've buffered, then change the
    // top-bar keyword filter. The page debounces the input, so the
    // assertion polls until a fresh request arrives.
    const requestsBeforeFilter = dailyLogRequests.length
    expect(requestsBeforeFilter).toBeGreaterThan(requestsBeforeLoadMore)

    // The page renders a top-bar Search input with a placeholder of
    // "Search logs". Filling it triggers a debounced re-fetch with
    // the cursor reset to the first page (`cursor=`).
    const searchInput = page.getByPlaceholder(/^search logs$/i).first()
    await expect(searchInput).toBeVisible()
    await searchInput.fill(filterMarker)

    await expect
      .poll(() => dailyLogRequests.length, { timeout: 15_000 })
      .toBeGreaterThan(requestsBeforeFilter)

    // The filter-reset request must again carry an empty cursor — that
    // is the signal the front end re-anchored to the first page rather
    // than continuing from wherever Load more left off.
    const resetRequests = dailyLogRequests.slice(requestsBeforeFilter)
    const filtered = resetRequests.find((url) =>
      url.searchParams.get("keywords")?.includes(filterMarker),
    )
    expect(
      filtered,
      `filter change must trigger a daily-logs request whose keywords include the marker. saw: ${resetRequests
        .map((u) => u.search)
        .join(" | ")}`,
    ).toBeTruthy()
    expect(filtered!.searchParams.has("cursor")).toBe(true)
    expect(
      filtered!.searchParams.get("cursor"),
      "changing a filter must reset the cursor to empty",
    ).toBe("")
    expect(filtered!.searchParams.has("page")).toBe(false)
    expect(filtered!.searchParams.has("pageSize")).toBe(false)
  })
})
