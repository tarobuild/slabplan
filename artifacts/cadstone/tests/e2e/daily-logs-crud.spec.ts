import { expect, test } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { requireAnyJob } from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

test.use({ storageState: CESAR_STATE })

/**
 * UI-driven CRUD coverage for the daily logs feed after Task #300.
 * The existing `daily-log.spec.ts` only covers the create-and-render
 * path via the API; this spec drives create + edit + delete through the
 * UI to exercise the generated mutation hooks (and their central cache
 * invalidation) end to end.
 */
test.describe("daily logs CRUD (UI)", () => {
  let token = ""
  let jobId = ""
  let createdLogId: string | null = null
  const stamp = Date.now()
  const initialNotes = `daily-logs-crud create ${stamp}`
  const renamedNotes = `daily-logs-crud edited ${stamp}`

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
    const job = await requireAnyJob(request, token)
    jobId = job.id
  })

  test.afterAll(async ({ request }) => {
    if (createdLogId) {
      await request.delete(`/api/daily-logs/${createdLogId}`, {
        headers: authHeaders(token),
      })
    }
  })

  test("create, edit, and delete a daily log through the UI", async ({
    page,
    request,
  }) => {
    await page.goto(`/jobs/${jobId}/daily-logs`)

    // CREATE — open the dialog, fill notes, click Publish.
    await page.getByRole("button", { name: /^daily log$/i }).first().click()
    await expect(page.getByText("Create Daily Log")).toBeVisible({
      timeout: 10_000,
    })
    await page
      .getByPlaceholder("Describe what happened on site today.")
      .fill(initialNotes)
    await page.getByRole("button", { name: /^publish$/i }).click()

    // The feed should reflect the new entry without manual reload thanks to
    // the generated hook's onSuccess invalidation.
    await expect(page.getByText(initialNotes).first()).toBeVisible({
      timeout: 15_000,
    })

    // Capture the id via the API so cleanup remains deterministic.
    const listRes = await request.get(
      `/api/jobs/${jobId}/daily-logs?limit=20`,
      { headers: authHeaders(token) },
    )
    const listBody = await listRes.json()
    const matched = (listBody.logs ?? []).find((l: { notes?: string }) =>
      (l.notes ?? "").includes(initialNotes),
    )
    createdLogId = matched?.id ?? null
    expect(createdLogId).toBeTruthy()

    // EDIT — open detail view, click the pencil, edit notes, save.
    await page.getByText(initialNotes).first().click()
    await page
      .getByRole("button", { name: "" })
      .filter({ has: page.locator("svg.lucide-pencil") })
      .first()
      .click()
      .catch(async () => {
        // Fallback: target the icon-only edit button by its surrounding role.
        await page.locator('button:has(svg.lucide-pencil)').first().click()
      })
    await expect(page.getByText("Edit Daily Log")).toBeVisible({
      timeout: 10_000,
    })
    const notesField = page.getByPlaceholder(
      "Describe what happened on site today.",
    )
    await notesField.fill(renamedNotes)
    await page.getByRole("button", { name: /^save$/i }).click()

    await expect(page.getByText(renamedNotes).first()).toBeVisible({
      timeout: 15_000,
    })

    // DELETE — open the more-actions menu in the detail view and click Delete.
    await page.locator('button:has(svg.lucide-more-horizontal)').first().click()
    await page.getByRole("menuitem", { name: /^delete$/i }).click()

    await expect(page.getByText(renamedNotes)).toHaveCount(0, {
      timeout: 15_000,
    })
    createdLogId = null
  })
})
