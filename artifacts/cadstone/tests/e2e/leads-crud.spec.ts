import { expect, test } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { CESAR_STATE } from "./helpers/storage"

test.use({ storageState: CESAR_STATE })

/**
 * UI-driven CRUD coverage for the leads page post-Task #300. Verifies
 * the generated mutation hooks + central invalidation helpers update the
 * list without manual reloads on every write.
 */
test.describe("leads CRUD (UI)", () => {
  let token = ""
  let createdLeadId: string | null = null
  const stamp = Date.now()
  const title = `E2E Lead ${stamp}`
  const renamedTitle = `${title} renamed`

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
  })

  test.afterAll(async ({ request }) => {
    if (createdLeadId) {
      await request.delete(`/api/leads/${createdLeadId}`, {
        headers: authHeaders(token),
      })
    }
  })

  test("create, edit, and delete a lead through the UI", async ({
    page,
    request,
  }) => {
    await page.goto("/leads")

    // CREATE — open the New Lead dialog and submit.
    await page.getByRole("button", { name: /new lead/i }).first().click()
    await page.getByLabel("Title *").fill(title)
    await page.getByRole("button", { name: /create lead/i }).click()

    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 })

    const listRes = await request.get(
      `/api/leads?search=${encodeURIComponent(title)}&page=1&pageSize=1`,
      { headers: authHeaders(token) },
    )
    const listBody = await listRes.json()
    createdLeadId = listBody.leads?.[0]?.id ?? null
    expect(createdLeadId).toBeTruthy()

    // EDIT — click the row to open the sheet, click Edit, rename, save.
    await page.getByText(title).first().click()
    await page
      .getByRole("button", { name: /^edit$/i })
      .first()
      .click()

    const titleInput = page.getByLabel("Title *")
    await titleInput.fill(renamedTitle)
    await page.getByRole("button", { name: /^save$/i }).first().click()

    await expect(page.getByText(renamedTitle).first()).toBeVisible({
      timeout: 10_000,
    })

    // Close the sheet and verify the list reflects the new title without a
    // reload (cache invalidation from useLeadsPutLeadsId).
    await page.keyboard.press("Escape")
    await expect(page.getByText(renamedTitle).first()).toBeVisible({
      timeout: 10_000,
    })

    // DELETE — click the row's trash icon, confirm in the AlertDialog.
    const row = page.locator("tr", { hasText: renamedTitle }).first()
    await row.locator("button").last().click()
    await expect(
      page.getByRole("alertdialog").getByText(/delete lead\?/i),
    ).toBeVisible()
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^delete$/i })
      .click()

    await expect(page.getByText(renamedTitle)).toHaveCount(0, {
      timeout: 10_000,
    })
    createdLeadId = null
  })
})
