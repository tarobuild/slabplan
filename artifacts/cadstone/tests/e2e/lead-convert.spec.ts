import { expect, test } from "@playwright/test"
import { CESAR, loginViaApi } from "./helpers/auth"
import { authHeaders } from "./helpers/auth"
import { deleteJob, requireAnyClient } from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

// Task #319 — exercise the Lead → Job conversion flow end-to-end:
//   1. Seed a fresh lead via API as Cesar (admin).
//   2. Open /leads, hit the Convert button, walk the 2-step modal,
//      submit, and verify we land on the new job's detail page.
//   3. Reload /leads with "Show converted" toggled on and confirm the
//      converted lead surfaces a "View linked job" button (proof that
//      `convertedJob` is hydrated and the row is hidden by default).
//
// All seed/teardown happens via the API so the suite stays
// self-contained; only the conversion itself goes through the UI.

test.use({ storageState: CESAR_STATE })

test.describe("lead convert-to-job", () => {
  let token = ""
  let createdLeadId: string | null = null
  let createdJobId: string | null = null

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
  })

  test.afterEach(async ({ request }) => {
    if (createdJobId) {
      await deleteJob(request, token, createdJobId)
      createdJobId = null
    }
    if (createdLeadId) {
      await request.delete(`/api/leads/${createdLeadId}`, {
        headers: authHeaders(token),
      })
      createdLeadId = null
    }
  })

  test("admin can convert a qualified lead into a job and the lead is then hidden by default", async ({
    page,
    request,
  }) => {
    const clientId = await requireAnyClient(request, token)

    // 1) Seed a lead.
    const leadTitle = `E2E Convert Lead ${Date.now()}`
    const createRes = await request.post("/api/leads", {
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      data: {
        title: leadTitle,
        status: "qualified",
        streetAddress: "123 Convert St",
        city: "Conversion City",
        state: "CA",
        zipCode: "90001",
      },
    })
    expect(createRes.ok(), `seed lead failed: ${createRes.status()}`).toBe(true)
    const createBody = (await createRes.json()) as { lead: { id: string } }
    createdLeadId = createBody.lead.id

    // 2) Open /leads, find our row, click Convert.
    await page.goto("/leads")
    await page
      .getByPlaceholder(/search/i)
      .first()
      .fill(leadTitle)

    const convertBtn = page.getByTestId(`convert-lead-${createdLeadId}`)
    await expect(convertBtn).toBeVisible({ timeout: 10_000 })
    await convertBtn.click()

    // Step 1: pick the existing client (already in "existing" mode by default).
    const clientList = page.getByTestId("convert-client-list")
    await expect(clientList).toBeVisible({ timeout: 10_000 })
    // The list paginates by 50; the fixture client is small enough to be
    // present, so pick whatever the first row resolves to.
    await page.waitForTimeout(500) // let the search settle
    const firstClientButton = clientList.locator("button").first()
    await expect(firstClientButton).toBeVisible({ timeout: 10_000 })
    await firstClientButton.click()
    await page.getByTestId("convert-next").click()

    // Step 2: tweak the title (proves overrides reach the backend) and
    // submit. We listen for the convert response so we know which job id
    // to navigate-assert against.
    const overrideTitle = `${leadTitle} (job)`
    const titleField = page.getByTestId("convert-job-title")
    await expect(titleField).toBeVisible()
    await titleField.fill(overrideTitle)

    const convertResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        res.url().includes(`/api/leads/${createdLeadId}/convert-to-job`) &&
        res.status() === 201,
      { timeout: 15_000 },
    )
    await page.getByTestId("convert-submit").click()
    const apiRes = await convertResponse
    const apiBody = (await apiRes.json()) as { job: { id: string } }
    createdJobId = apiBody.job.id

    // 3) We should land on the new job's detail page.
    await page.waitForURL(`**/jobs/${createdJobId}/summary`, { timeout: 15_000 })
    await expect(page.getByText(overrideTitle).first()).toBeVisible({
      timeout: 10_000,
    })

    // Used the body's clientId — verify the server set it on the job.
    const jobDetail = await request.get(`/api/jobs/${createdJobId}`, {
      headers: authHeaders(token),
    })
    expect(jobDetail.ok()).toBe(true)
    const jobDetailBody = (await jobDetail.json()) as {
      job: { clientId: string | null }
    }
    expect(jobDetailBody.job.clientId).toBe(clientId)

    // 4) Lead is now hidden from the default leads list.
    await page.goto("/leads")
    await page
      .getByPlaceholder(/search/i)
      .first()
      .fill(leadTitle)
    await expect(
      page.getByTestId(`convert-lead-${createdLeadId}`),
    ).toHaveCount(0, { timeout: 10_000 })
    await expect(
      page.getByTestId(`view-job-${createdLeadId}`),
    ).toHaveCount(0)

    // Toggle "Show converted" — the row reappears with a View Job
    // affordance pointing at the new job.
    await page.getByTestId("show-converted-toggle").check()
    await expect(
      page.getByTestId(`view-job-${createdLeadId}`),
    ).toBeVisible({ timeout: 10_000 })
  })
})
