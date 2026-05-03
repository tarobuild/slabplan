import { expect, test } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { CESAR_STATE } from "./helpers/storage"

test.use({ storageState: CESAR_STATE })

/**
 * UI-driven CRUD coverage for the clients page after the migration to
 * generated `useMutation` hooks (Task #300). Exercising create + edit +
 * delete entirely through the UI verifies the central cache-invalidation
 * helpers fire correctly (lists update without a manual reload) and the
 * shared `toastApiError` path stays wired.
 */
test.describe("clients CRUD (UI)", () => {
  let token = ""
  let createdClientId: string | null = null
  const stamp = Date.now()
  const companyName = `E2E Client ${stamp}`
  const renamedCompany = `${companyName} Renamed`

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
  })

  test.afterAll(async ({ request }) => {
    // Best-effort cleanup if the spec failed mid-flight.
    if (createdClientId) {
      await request.delete(`/api/clients/${createdClientId}`, {
        headers: authHeaders(token),
      })
    }
  })

  test("create, edit, and delete a client through the UI", async ({
    page,
    request,
  }) => {
    await page.goto("/clients")

    // CREATE — open New Client dialog, fill required field, submit.
    await page.getByRole("button", { name: /new client/i }).first().click()
    await page.getByLabel("Company Name *").fill(companyName)
    await page.getByRole("button", { name: /^create client$/i }).click()

    // Cache invalidation should make the new row appear without a reload.
    await expect(page.getByText(companyName).first()).toBeVisible({
      timeout: 15_000,
    })

    // Resolve the created id so afterAll cleanup is deterministic even if a
    // later assertion fails before the UI delete completes.
    const listRes = await request.get(
      `/api/clients?search=${encodeURIComponent(companyName)}&page=1&pageSize=1`,
      { headers: authHeaders(token) },
    )
    const listBody = await listRes.json()
    createdClientId = listBody.clients?.[0]?.id ?? null
    expect(createdClientId).toBeTruthy()

    // EDIT — open the detail sheet, click the pencil, rename, save.
    await page.getByText(companyName).first().click()
    await page
      .getByRole("button", { name: /edit client/i })
      .first()
      .click()
    const companyInput = page.getByLabel("Company Name *")
    await companyInput.fill(renamedCompany)
    await page.getByRole("button", { name: /^save$/i }).click()

    // The sheet stays open with the renamed title; the underlying list also
    // updates via the mutation hook's invalidation.
    await expect(page.getByText(renamedCompany).first()).toBeVisible({
      timeout: 10_000,
    })

    // Close the sheet so the list is the only thing rendering the name,
    // then assert the list shows the renamed entry without a reload.
    await page.keyboard.press("Escape")
    await expect(page.getByText(renamedCompany).first()).toBeVisible({
      timeout: 10_000,
    })

    // DELETE — open sheet again, click trash, confirm in the AlertDialog.
    await page.getByText(renamedCompany).first().click()
    await page
      .getByRole("button", { name: /delete client/i })
      .first()
      .click()
    await expect(
      page.getByRole("alertdialog").getByText(/delete client\?/i),
    ).toBeVisible()
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^delete$/i })
      .click()

    // Once the AlertDialog closes the list should no longer contain the row.
    await expect(page.getByText(renamedCompany)).toHaveCount(0, {
      timeout: 10_000,
    })
    createdClientId = null
  })
})
