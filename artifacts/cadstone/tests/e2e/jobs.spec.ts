import { expect, test } from "@playwright/test"
import { CESAR, loginViaApi } from "./helpers/auth"
import { createTestJob, deleteJob, requireAnyClient } from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

test.use({ storageState: CESAR_STATE })

test.describe("jobs", () => {
  let createdJobId: string | null = null
  let token = ""

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
  })

  test.afterEach(async ({ request }) => {
    if (createdJobId) {
      await deleteJob(request, token, createdJobId)
      createdJobId = null
    }
  })

  test("creating a custom job surfaces it on the jobs list and the detail page", async ({
    page,
    request,
  }) => {
    const clientId = await requireAnyClient(request, token)

    const title = `E2E smoke job ${Date.now()}`
    createdJobId = await createTestJob(request, token, {
      title,
      clientId,
    })

    await page.goto("/jobs")

    // The newly created job should be findable via the search box.
    const searchBox = page
      .getByPlaceholder(/search/i)
      .or(page.getByRole("textbox", { name: /search/i }))
      .first()
    await searchBox.fill(title)
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 })

    // Deep-link straight to the job detail page and confirm the tabs render.
    await page.goto(`/jobs/${createdJobId}`)
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByRole("link", { name: /daily logs/i }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: /schedule/i }).first(),
    ).toBeVisible()
  })
})
