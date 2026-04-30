import { expect, test } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { requireAnyJob } from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

test.use({ storageState: CESAR_STATE })

/**
 * Smoke test for job schedule:
 *  - Create a schedule item via the API
 *  - Visit the schedule page, confirm it renders
 *  - Reschedule it +1 day via the API
 *  - Mark it complete via the API
 *  - Reload; assert the item is still listed
 *  - Clean up
 *
 * We deliberately avoid exercising the Gantt drag-and-drop because it's
 * pixel-sensitive and tends to be flaky in headless runs. The backend
 * reschedule endpoint covers the same invariant.
 */
test.describe("schedule", () => {
  let token = ""
  let jobId = ""
  let itemId: string | null = null
  const title = `E2E schedule item ${Date.now()}`

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
    const job = await requireAnyJob(request, token)
    jobId = job.id
  })

  test.afterAll(async ({ request }) => {
    if (itemId) {
      await request.delete(`/api/schedule-items/${itemId}`, {
        headers: authHeaders(token),
      })
    }
  })

  test("creates a task, reschedules it +1 day, and marks it complete", async ({
    page,
    request,
  }) => {
    const today = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const startDate = iso(today)
    const nextDate = iso(new Date(today.getTime() + 24 * 60 * 60 * 1000))

    const createRes = await request.post(`/api/jobs/${jobId}/schedule`, {
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      data: {
        title,
        startDate,
        endDate: startDate,
        itemType: "task",
      },
    })
    expect(
      createRes.ok(),
      `schedule create failed: ${createRes.status()} ${await createRes.text()}`,
    ).toBeTruthy()
    const createBody = await createRes.json()
    itemId = createBody.item?.id ?? createBody.id ?? null
    expect(itemId).toBeTruthy()

    await page.goto(`/jobs/${jobId}/schedule`)
    // The default month calendar view renders item titles inside date
    // cells that can cap at 4 lanes per week, hiding extras behind a
    // "+N more" affordance. Switch to the List view, which renders
    // every item's title as a plain table cell.
    await page.getByRole("button", { name: /^list$/i }).first().click()
    await expect(page.getByText(title).first()).toBeVisible({
      timeout: 15_000,
    })

    // PUT /schedule-items/:id replaces the whole payload, so include all
    // required fields even when the test only cares about the dates.
    const patchRes = await request.put(
      `/api/schedule-items/${itemId}`,
      {
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json",
        },
        data: {
          title,
          itemType: "task",
          startDate: nextDate,
          endDate: nextDate,
        },
      },
    )
    expect(
      patchRes.ok(),
      `reschedule failed: ${patchRes.status()} ${await patchRes.text()}`,
    ).toBeTruthy()

    const completeRes = await request.put(
      `/api/schedule-items/${itemId}`,
      {
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json",
        },
        data: {
          title,
          itemType: "task",
          startDate: nextDate,
          endDate: nextDate,
          status: "complete",
        },
      },
    )
    expect(
      completeRes.ok(),
      `complete failed: ${completeRes.status()} ${await completeRes.text()}`,
    ).toBeTruthy()

    await page.reload()
    await page.getByRole("button", { name: /^list$/i }).first().click()
    await expect(page.getByText(title).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
