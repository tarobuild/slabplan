import { expect, test } from "@playwright/test"
import { ANWAR, CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { requireAnyJob } from "./helpers/api"
import { ANWAR_STATE } from "./helpers/storage"

// Anwar navigates the UI to confirm he can't see Cesar's private todo,
// so load the suite as Anwar by default.
test.use({ storageState: ANWAR_STATE })

/**
 * Security regression: a personal to-do created by Cesar must never be
 * visible to any other user — not on the dashboard, not on the job
 * schedule, not via search, and not by direct API poke at the schedule
 * endpoint. This was the audit's P0 finding.
 */
test.describe("personal-todo isolation", () => {
  let cesarToken = ""
  let anwarToken = ""
  let jobId = ""
  let todoId: string | null = null
  const title = `Cesar private todo ${Date.now()}`

  test.beforeAll(async ({ request }) => {
    cesarToken = (await loginViaApi(request, CESAR)).accessToken
    anwarToken = (await loginViaApi(request, ANWAR)).accessToken

    const job = await requireAnyJob(request, cesarToken)
    jobId = job.id

    // Create a personal todo on the job as Cesar.
    const startDate = new Date().toISOString().slice(0, 10)
    const createRes = await request.post(`/api/jobs/${jobId}/schedule`, {
      headers: {
        ...authHeaders(cesarToken),
        "Content-Type": "application/json",
      },
      data: {
        title,
        startDate,
        endDate: startDate,
        itemType: "todo",
        isPersonalTodo: true,
      },
    })
    expect(
      createRes.ok(),
      `personal-todo create failed: ${createRes.status()} ${await createRes.text()}`,
    ).toBeTruthy()
    const body = await createRes.json()
    todoId = body.item?.id ?? body.id ?? null
  })

  test.afterAll(async ({ request }) => {
    if (todoId) {
      await request.delete(`/api/schedule-items/${todoId}`, {
        headers: authHeaders(cesarToken),
      })
    }
  })

  test("API: GET /jobs/:jobId/schedule as Anwar must not return the todo", async ({
    request,
  }) => {
    const res = await request.get(`/api/jobs/${jobId}/schedule?limit=500`, {
      headers: authHeaders(anwarToken),
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    const items: Array<{ id: string; title: string }> = body.items ?? []
    expect(items.find((item) => item.id === todoId)).toBeUndefined()
    expect(items.find((item) => item.title === title)).toBeUndefined()
  })

  test("API: direct GET /schedule-items/:id as Anwar must be forbidden", async ({
    request,
  }) => {
    test.skip(!todoId, "No todo id recorded")
    const res = await request.get(`/api/schedule-items/${todoId}`, {
      headers: authHeaders(anwarToken),
    })
    // 403 (forbidden) or 404 (hidden entirely) are both acceptable — what
    // must NOT happen is a 200 returning the body.
    expect([403, 404]).toContain(res.status())
  })

  test("UI: Anwar on the job schedule page must not see the todo title", async ({
    page,
  }) => {
    await page.goto(`/jobs/${jobId}/schedule`)
    await page.waitForLoadState("networkidle")
    await expect(page.locator("body")).not.toContainText(title)
  })
})
