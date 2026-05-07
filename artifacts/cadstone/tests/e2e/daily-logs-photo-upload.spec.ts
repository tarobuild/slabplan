import { expect, test } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { requireAnyJob } from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

test.use({ storageState: CESAR_STATE })

/**
 * Task #358 — workers in the field need to drop a phone snapshot
 * straight into the daily log dialog. This test drives the new
 * "any" media-type upload path through the UI: pick a real PNG via
 * the dropzone input, publish the log, then assert the saved
 * attachment renders as an image tile in the feed (the read-after-
 * write thumbnail proves the server actually accepted and stored
 * the photo, not just shrugged off the document-only validator).
 */
test.describe("daily logs photo upload (UI)", () => {
  let token = ""
  let jobId = ""
  let createdLogId: string | null = null
  const stamp = Date.now()
  const logNotes = `daily-logs-photo ${stamp}`
  const photoName = `field-photo-${stamp}.png`

  // 1×1 transparent PNG.
  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  )

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

  test("upload a PNG via the daily log dialog and see it as an image tile", async ({
    page,
    request,
  }) => {
    await page.goto(`/jobs/${jobId}/daily-logs`)

    await page.getByRole("button", { name: /^daily log$/i }).first().click()
    const logDialog = page.getByRole("dialog")
    await expect(logDialog.getByText("Create Daily Log")).toBeVisible({
      timeout: 10_000,
    })

    await logDialog
      .getByPlaceholder("Describe what happened on site today.")
      .fill(logNotes)

    // The dropzone input is hidden under display:none so query by type.
    // The first file input in the dialog is the dropzone (the camera
    // input is rendered after it but is also a file input — both work
    // for a programmatic setInputFiles).
    const attachmentInput = logDialog.locator('input[type="file"]').first()
    await attachmentInput.setInputFiles({
      name: photoName,
      mimeType: "image/png",
      buffer: pngBuffer,
    })

    // The pending attachment should appear in the in-dialog list.
    await expect(logDialog.getByText(photoName)).toBeVisible({
      timeout: 5_000,
    })

    const logCreatePromise = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/jobs\/[^/]+\/daily-logs$/.test(res.url()) &&
        res.ok(),
      { timeout: 20_000 },
    )
    await logDialog.getByRole("button", { name: /^publish$/i }).click()
    const logResp = await logCreatePromise
    const logBody = await logResp.json()
    createdLogId = logBody.log?.id ?? logBody.dailyLog?.id ?? logBody.id ?? null
    expect(createdLogId).toBeTruthy()

    // The feed should render the photo tile (not a generic file icon).
    await expect(page.getByText(logNotes).first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByRole("img", { name: photoName }).first(),
    ).toBeVisible({ timeout: 15_000 })

    // Confirm the server actually persisted an image-mime attachment.
    const detail = await request.get(`/api/daily-logs/${createdLogId}`, {
      headers: authHeaders(token),
    })
    const detailBody = await detail.json()
    const attachments =
      detailBody.log?.attachments ?? detailBody.dailyLog?.attachments ?? detailBody.attachments ?? []
    const photo = attachments.find((a: { originalName?: string }) =>
      (a.originalName ?? "").includes(photoName),
    )
    expect(photo).toBeTruthy()
    expect(String(photo.mimeType ?? "")).toMatch(/^image\//)
  })
})
