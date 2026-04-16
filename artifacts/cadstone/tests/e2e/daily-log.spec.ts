import { expect, test } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { pickAnyJob } from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

test.use({ storageState: CESAR_STATE })

/**
 * Smoke test for the daily log feed: create a log entry via the API,
 * confirm it renders on /jobs/:jobId/daily-logs, then clean up.
 */
test.describe("daily log", () => {
  let token = ""
  let jobId = ""
  let createdLogId: string | null = null
  const stamp = Date.now()
  const logTitle = `E2E log ${stamp}`
  // The feed card renders `notes` in a blockquote but NOT the title, so
  // put a unique marker in the notes to assert on in the UI.
  const logNotes = `smoke-test entry ${stamp} created by playwright`

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
    const job = await pickAnyJob(request, token)
    test.skip(!job, "Need at least one job to attach a daily log to")
    jobId = job!.id
  })

  test.afterAll(async ({ request }) => {
    if (createdLogId) {
      await request.delete(`/api/daily-logs/${createdLogId}`, {
        headers: authHeaders(token),
      })
    }
  })

  test("creates a daily log and renders it on the job feed", async ({
    page,
    request,
  }) => {
    const today = new Date().toISOString().slice(0, 10)
    const createRes = await request.post(`/api/jobs/${jobId}/daily-logs`, {
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      data: {
        logDate: today,
        title: logTitle,
        notes: logNotes,
      },
    })
    expect(
      createRes.ok(),
      `daily-log create failed: ${createRes.status()} ${await createRes.text()}`,
    ).toBeTruthy()
    const createBody = await createRes.json()
    createdLogId =
      createBody.log?.id ?? createBody.dailyLog?.id ?? createBody.id ?? null
    expect(createdLogId).toBeTruthy()

    await page.goto(`/jobs/${jobId}/daily-logs`)
    await expect(page.getByText(logNotes).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
