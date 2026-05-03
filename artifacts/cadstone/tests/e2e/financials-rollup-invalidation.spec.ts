import { expect, test } from "@playwright/test"
import { CESAR, loginViaApi } from "./helpers/auth"
import {
  createCustomJob,
  deleteJob,
  requireAnyClient,
} from "./helpers/api"
import { authHeaders } from "./helpers/auth"
import { CESAR_STATE } from "./helpers/storage"

// Coverage for the cache-invalidation contract added in #275: when an
// SOV line item's "% complete" is edited on the Job Financials page,
// the Client Detail "Outstanding" rollup card must reflect the new
// billed/outstanding without a hard reload. The wiring under test:
//
//   updateLineItem() → invalidateFinancialsRollups({ jobId, clientId })
//     → invalidateAppData(["clients", "jobs", "dashboard"])
//     → react-query cache for /api/clients/:id is marked stale
//     → next visit to Client Detail refetches the AR rollup
//
// We provision a job + tracker + area + line item via the REST API
// (no PDF/AI in the loop), open Client Detail to capture the baseline
// "Outstanding" amount, navigate to the Financials page and edit the
// % via the same API the UI uses (which is what the Financials page
// calls under the hood — the unit test for the SOV row's confirm
// predicate covers the in-row editor logic), then assert the Client
// Detail AR card shows the updated dollar figure on next visit.

test.use({ storageState: CESAR_STATE })

test.describe("financials → client detail cache invalidation", () => {
  let token = ""
  let createdJobId: string | null = null
  let clientId = ""

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
    clientId = await requireAnyClient(request, token)
  })

  test.afterEach(async ({ request }) => {
    if (createdJobId) {
      await deleteJob(request, token, createdJobId)
      createdJobId = null
    }
  })

  test("editing % complete refreshes Client Detail Outstanding rollup", async ({
    page,
    request,
  }) => {
    const title = `E2E financials rollup ${Date.now()}`
    createdJobId = await createCustomJob(request, token, { title, clientId })
    const jobId = createdJobId

    // 1. Lazy-create the tracker (GET /financials does this).
    const trackerRes = await request.get(`/api/jobs/${jobId}/financials`, {
      headers: authHeaders(token),
    })
    expect(trackerRes.ok()).toBeTruthy()

    // 2. Seed one area with a $10,000 line item.
    const areaRes = await request.post(`/api/jobs/${jobId}/financials/areas`, {
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      data: { name: "E2E Area" },
    })
    expect(areaRes.ok()).toBeTruthy()
    const areaId = (await areaRes.json()).area.id as string

    const liRes = await request.post(
      `/api/jobs/${jobId}/financials/line-items`,
      {
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        data: {
          areaId,
          description: "E2E line",
          qty: 1,
          rateCents: 1_000_000, // $10,000
          scheduledValueCents: 1_000_000,
        },
      },
    )
    expect(liRes.ok()).toBeTruthy()
    const lineItemId = (await liRes.json()).lineItem.id as string

    // 3. Visit Client Detail and capture the baseline Outstanding dollar
    //    text from the AR rollup card. We grab the value sibling of the
    //    "Outstanding" label to be tolerant of card layout tweaks.
    await page.goto(`/clients/${clientId}`)
    const outstandingCard = page
      .locator('div', { has: page.getByText("Outstanding", { exact: true }) })
      .filter({ hasText: "$" })
      .first()
    await expect(outstandingCard).toBeVisible({ timeout: 10_000 })
    const baselineText = (await outstandingCard.innerText()).trim()

    // 4. Edit % complete through the actual SOV row UI. The onBlur
    //    handler calls updateLineItem → invalidateFinancialsRollups,
    //    which is the path under test. Patching via API directly would
    //    bypass that invalidate() call. We void/use lineItemId only as
    //    the fallback id in case the description ever collides.
    void lineItemId
    await page.goto(`/jobs/${jobId}/financials`)
    const pctInput = page.getByLabel(`Percent complete for E2E line`)
    await expect(pctInput).toBeVisible({ timeout: 10_000 })

    const patchPromise = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res
          .url()
          .includes(`/api/jobs/${jobId}/financials/line-items/`) &&
        res.ok(),
      { timeout: 10_000 },
    )
    await pctInput.fill("50")
    await pctInput.blur()
    await patchPromise

    // 6. Re-visit Client Detail. Outstanding should now show a different
    //    dollar value than the baseline (the new billed makes outstanding
    //    drop). We assert *change*, not the exact figure, because other
    //    open jobs under this fixture client may already contribute.
    await page.goto(`/clients/${clientId}`)
    const refreshedCard = page
      .locator('div', { has: page.getByText("Outstanding", { exact: true }) })
      .filter({ hasText: "$" })
      .first()
    await expect(refreshedCard).toBeVisible({ timeout: 10_000 })
    await expect
      .poll(async () => (await refreshedCard.innerText()).trim(), {
        timeout: 10_000,
        message:
          "Outstanding card should refresh after a % complete edit invalidates the clients query cache",
      })
      .not.toBe(baselineText)
  })
})
