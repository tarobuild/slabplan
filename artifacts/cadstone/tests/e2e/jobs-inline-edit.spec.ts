import { expect, test, type Page } from "@playwright/test"
import {
  CESAR,
  WORKER_EMAIL,
  loginViaApi,
} from "./helpers/auth"
import {
  createCustomJob,
  deleteJob,
  ensureProjectManagerFixture,
  fetchJobDetail,
  findUserIdByEmail,
  requireAnyClient,
} from "./helpers/api"
import { CESAR_STATE, WORKER_STATE } from "./helpers/storage"

// These specs cover the inline editors on the /jobs list:
//   * ProjectManagerPopover (admin-only)
//   * DatePopover for projectedStart and projectedCompletion (admin or
//     PM-of-job)
// The legacy jobs.spec.ts already exercises the create-job flow and
// detail page navigation, so we keep those concerns separate here.

/**
 * The inline editors do an optimistic UI update first and then send a PUT
 * to /api/jobs/:id. The optimistic update completes before the PUT, so a
 * naive `await trigger.click(); fetchJobDetail()` races and reads the
 * pre-edit row. Wrapping the user action in this helper guarantees we
 * only proceed once the PUT has returned 2xx.
 */
async function waitForJobPut(
  page: Page,
  jobId: string,
  action: () => Promise<void>,
): Promise<void> {
  const responsePromise = page.waitForResponse(
    (res) =>
      res.request().method() === "PUT" &&
      res.url().includes(`/api/jobs/${jobId}`) &&
      res.ok(),
    { timeout: 10_000 },
  )
  await action()
  await responsePromise
}

test.describe("jobs inline editors — admin", () => {
  test.use({ storageState: CESAR_STATE })

  let token = ""
  let pm: { id: string; fullName: string }
  let createdJobId: string | null = null

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
    pm = await ensureProjectManagerFixture(request, token)
  })

  test.afterEach(async ({ request }) => {
    if (createdJobId) {
      await deleteJob(request, token, createdJobId)
      createdJobId = null
    }
  })

  test("admin can assign/clear PM and set/clear projected dates from the listing", async ({
    page,
    request,
  }) => {
    const clientId = await requireAnyClient(request, token)
    const title = `E2E inline edits ${Date.now()}`
    createdJobId = await createCustomJob(request, token, { title, clientId })
    const jobId = createdJobId

    await page.goto("/jobs")
    await page
      .getByPlaceholder(/search/i)
      .first()
      .fill(title)

    // Wait for the search-debounced refetch to settle on a single row.
    await expect(
      page.getByRole("link", { name: `Open job ${title}` }),
    ).toHaveCount(1, { timeout: 10_000 })
    const row = page
      .getByRole("link", { name: `Open job ${title}` })
      .first()

    // ---- Project Manager picker ----
    const pmTrigger = row.getByRole("button", {
      name: /Change project manager/i,
    })
    await expect(pmTrigger).toContainText("Unassigned")

    await pmTrigger.click()
    // Popover content is portaled to <body>, so query at page scope.
    await waitForJobPut(page, jobId, async () => {
      await page
        .getByRole("menuitemradio", { name: pm.fullName })
        .click()
    })
    await expect(pmTrigger).toContainText(pm.fullName)

    let detail = await fetchJobDetail(request, token, jobId)
    expect(detail.projectManagerId).toBe(pm.id)

    await pmTrigger.click()
    await waitForJobPut(page, jobId, async () => {
      await page
        .getByRole("menuitemradio", { name: /^Unassigned$/i })
        .click()
    })
    await expect(pmTrigger).toContainText("Unassigned")

    detail = await fetchJobDetail(request, token, jobId)
    expect(detail.projectManagerId).toBeNull()

    // ---- Projected start date ----
    const startTrigger = row.getByRole("button", {
      name: `Change start date for ${title}`,
    })
    await expect(startTrigger).toContainText("—")

    await startTrigger.click()
    await page
      .locator('input[type="date"]:visible')
      .fill("2026-06-15")
    await waitForJobPut(page, jobId, async () => {
      await page.getByRole("button", { name: /^Save$/ }).click()
    })
    await expect(startTrigger).toContainText("Jun 15, 2026")

    detail = await fetchJobDetail(request, token, jobId)
    expect(detail.projectedStart).toBe("2026-06-15")

    await startTrigger.click()
    await waitForJobPut(page, jobId, async () => {
      await page.getByRole("button", { name: /^Clear$/ }).click()
    })
    await expect(startTrigger).toContainText("—")

    detail = await fetchJobDetail(request, token, jobId)
    expect(detail.projectedStart).toBeNull()

    // ---- Projected completion date ----
    const endTrigger = row.getByRole("button", {
      name: `Change estimated completion for ${title}`,
    })
    await expect(endTrigger).toContainText("—")

    await endTrigger.click()
    await page
      .locator('input[type="date"]:visible')
      .fill("2026-08-30")
    await waitForJobPut(page, jobId, async () => {
      await page.getByRole("button", { name: /^Save$/ }).click()
    })
    await expect(endTrigger).toContainText("Aug 30, 2026")

    detail = await fetchJobDetail(request, token, jobId)
    expect(detail.projectedCompletion).toBe("2026-08-30")

    await endTrigger.click()
    await waitForJobPut(page, jobId, async () => {
      await page.getByRole("button", { name: /^Clear$/ }).click()
    })
    await expect(endTrigger).toContainText("—")

    detail = await fetchJobDetail(request, token, jobId)
    expect(detail.projectedCompletion).toBeNull()
  })
})

test.describe("jobs inline editors — worker (read-only)", () => {
  test.use({ storageState: WORKER_STATE })

  // Setup uses the admin token; the spec body runs as the worker.
  let adminToken = ""
  let workerId: string
  let createdJobId: string | null = null

  test.beforeAll(async ({ request }) => {
    adminToken = (await loginViaApi(request, CESAR)).accessToken
    const id = await findUserIdByEmail(request, adminToken, WORKER_EMAIL)
    if (!id) {
      throw new Error(
        `Worker fixture user (${WORKER_EMAIL}) is missing. Re-seed the local ` +
          `DB with seed-users.mjs --db=local (it provisions worker@stone-track.test).`,
      )
    }
    workerId = id
  })

  test.afterEach(async ({ request }) => {
    if (createdJobId) {
      await deleteJob(request, adminToken, createdJobId)
      createdJobId = null
    }
  })

  test("crew_member sees PM and projected-date cells as static, non-interactive text", async ({
    page,
    request,
  }) => {
    const clientId = await requireAnyClient(request, adminToken)
    const title = `E2E worker readonly ${Date.now()}`
    // Assign the worker so the job is visible in their /jobs listing
    // (crew_members can only see jobs they're attached to). Seed both
    // dates so we can assert the read-only spans render *something*
    // rather than the unset placeholder.
    createdJobId = await createCustomJob(request, adminToken, {
      title,
      clientId,
      assigneeIds: [workerId],
      projectedStart: "2026-07-01",
      projectedCompletion: "2026-09-15",
    })

    await page.goto("/jobs")
    await page
      .getByPlaceholder(/search/i)
      .first()
      .fill(title)

    await expect(
      page.getByRole("link", { name: `Open job ${title}` }),
    ).toHaveCount(1, { timeout: 10_000 })
    const row = page
      .getByRole("link", { name: `Open job ${title}` })
      .first()

    // None of the inline editor triggers should render for a crew_member:
    // the PM cell is gated by isAdmin, and the date cells share the same
    // gate as inline status (admin or PM-of-job). The worker is neither.
    await expect(
      row.getByRole("button", { name: /Change project manager/i }),
    ).toHaveCount(0)
    await expect(
      row.getByRole("button", {
        name: `Change start date for ${title}`,
      }),
    ).toHaveCount(0)
    await expect(
      row.getByRole("button", {
        name: `Change estimated completion for ${title}`,
      }),
    ).toHaveCount(0)

    // Cells follow the desktop table column order:
    //   0 Title | 1 Client | 2 Location | 3 Type | 4 PM | 5 Status |
    //   6 Start | 7 End | 8 Contract Price | 9 Created
    // We pin the assertions to those exact cells so a future regression
    // (e.g. the read-only span dropping the formatted date) can't slip
    // past a row-wide `toContainText` that also matches the row's own
    // "Created" date.
    const cells = row.locator("td")
    const pmCell = cells.nth(4)
    const startCell = cells.nth(6)
    const endCell = cells.nth(7)

    // PM falls back to either the assigned PM's full name or an italic
    // "Unassigned" placeholder. The worker's /users fetch is gated to
    // admins, so projectManagerOptions is empty for this viewer and the
    // span renders "Unassigned" even if a PM had been set — that
    // mismatch isn't this test's problem; we only care that the cell is
    // a static text node, not a button.
    await expect(pmCell.locator("button")).toHaveCount(0)
    await expect(pmCell).toContainText("Unassigned")

    // Date cells use Intl date formatting with month=short, year=numeric.
    // We allow either local-day or UTC-shifted-day rendering (see the
    // followup task on date format inconsistency) by matching the month
    // and year only, but pinned to the correct cell so a blank cell
    // would fail.
    await expect(startCell.locator("button")).toHaveCount(0)
    await expect(startCell).toContainText(/Ju[nl] \d{1,2}, 2026/)
    await expect(endCell.locator("button")).toHaveCount(0)
    await expect(endCell).toContainText(/Sep \d{1,2}, 2026/)
  })
})
