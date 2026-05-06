import { expect, test } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { deleteJob, requireAnyClient } from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

// Task #343 — pin the "Converted" status filter + violet "Converted"
// badge from Task #330.
//
// Sibling spec `lead-convert.spec.ts` covers the Show converted toggle
// path; this spec covers the dedicated dropdown entry that sends
// `?onlyConverted=true` and the badge color flip driven by the
// `convertedJob` ref returned by the list endpoint.
//
// Flow:
//   1. Seed a lead and convert it via the API (so the activity_log row
//      that listConvertedLeadIds joins on actually exists).
//   2. Open /leads, pick "Converted" in the status dropdown.
//   3. Assert the seeded lead's row renders a Badge labeled "Converted"
//      with the violet color class (`bg-violet-50`) wired up by
//      getDisplayStatus().
//   4. Assert the "Show converted" toggle is hidden (the Converted
//      filter already restricts the list to converted leads, so the
//      toggle would be redundant — see the comment in pages/leads.tsx).
//
// Seed/teardown happens via the API so the spec stays self-contained.

test.use({ storageState: CESAR_STATE })

test.describe("leads — Converted status filter + badge", () => {
  let token = ""
  let convertedLeadId: string | null = null
  let plainWonLeadId: string | null = null
  let createdJobId: string | null = null

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
  })

  test.afterEach(async ({ request }) => {
    if (createdJobId) {
      await deleteJob(request, token, createdJobId)
      createdJobId = null
    }
    for (const id of [convertedLeadId, plainWonLeadId]) {
      if (!id) continue
      await request.delete(`/api/leads/${id}`, {
        headers: authHeaders(token),
      })
    }
    convertedLeadId = null
    plainWonLeadId = null
  })

  test('picking "Converted" in the dropdown shows the violet pill, hides the Show converted toggle, and excludes plain-won leads', async ({
    page,
    request,
  }) => {
    const clientId = await requireAnyClient(request, token)

    // Seed two leads sharing a per-run marker so the search box
    // narrows to exactly the rows this test owns. One will be
    // converted (gets an activity_log row + a live job); the other
    // stays a plain "won" lead so we can prove the Converted filter
    // actually excludes it.
    const marker = `E2E_CONVERTED_FILTER_${Date.now()}`
    const convertedTitle = `${marker} converted`
    const plainWonTitle = `${marker} plain-won`

    const createConverted = await request.post("/api/leads", {
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      data: {
        title: convertedTitle,
        status: "qualified",
        streetAddress: "1 Converted Filter Way",
        city: "Convertopolis",
        state: "CA",
        zipCode: "90001",
      },
    })
    expect(
      createConverted.ok(),
      `seed converted lead failed: ${createConverted.status()}`,
    ).toBe(true)
    convertedLeadId = (
      (await createConverted.json()) as { lead: { id: string } }
    ).lead.id

    const createPlainWon = await request.post("/api/leads", {
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      data: {
        title: plainWonTitle,
        status: "won",
        streetAddress: "2 Plain Won Way",
        city: "Convertopolis",
        state: "CA",
        zipCode: "90001",
      },
    })
    expect(
      createPlainWon.ok(),
      `seed plain-won lead failed: ${createPlainWon.status()}`,
    ).toBe(true)
    plainWonLeadId = (
      (await createPlainWon.json()) as { lead: { id: string } }
    ).lead.id

    // Convert the first one via API so the activity_log row that
    // drives the Converted filter exists.
    const convertRes = await request.post(
      `/api/leads/${convertedLeadId}/convert-to-job`,
      {
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        data: { clientId },
      },
    )
    expect(
      convertRes.ok(),
      `convert lead failed: ${convertRes.status()} ${await convertRes.text()}`,
    ).toBe(true)
    createdJobId = ((await convertRes.json()) as { job: { id: string } }).job.id

    // Open /leads and narrow to just our seeded rows via search.
    await page.goto("/leads")
    await page
      .getByPlaceholder(/search/i)
      .first()
      .fill(marker)

    // Pick "Converted" from the status dropdown and capture the
    // outgoing /api/leads request to prove the UI sends
    // `onlyConverted=true` (the contract piece the badge depends on).
    const convertedRequest = page.waitForRequest((req) => {
      if (req.method() !== "GET") return false
      const url = new URL(req.url())
      if (!url.pathname.endsWith("/api/leads")) return false
      return url.searchParams.get("onlyConverted") === "true"
    })

    await page.getByRole("combobox").first().click()
    await page.getByRole("option", { name: /^Converted$/ }).click()

    await convertedRequest

    // The converted row renders with the violet Converted pill. Scope
    // the badge lookup to the row to avoid matching the dropdown
    // trigger (which now also reads "Converted").
    const convertedRow = page
      .locator("tr", { hasText: convertedTitle })
      .first()
    await expect(convertedRow).toBeVisible({ timeout: 10_000 })

    const badge = convertedRow
      .locator(".inline-flex")
      .filter({ hasText: /^Converted$/ })
      .first()
    await expect(badge).toBeVisible({ timeout: 10_000 })
    // Violet color class wired up by CONVERTED_STATUS_COLOR /
    // getDisplayStatus() in pages/leads.tsx.
    await expect(badge).toHaveClass(/bg-violet-50/)

    // The plain-won lead must not appear under the Converted filter
    // — this is the end-to-end exclusivity guarantee.
    await expect(
      page.locator("tr", { hasText: plainWonTitle }),
    ).toHaveCount(0)

    // The "Show converted" toggle is hidden whenever the Converted
    // filter is the active status (the list is already restricted to
    // converted leads, so the toggle would be redundant).
    await expect(page.getByTestId("show-converted-toggle")).toHaveCount(0)
  })
})
