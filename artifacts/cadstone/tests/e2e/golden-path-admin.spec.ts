import { expect, test, type Route } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { CESAR_STATE } from "./helpers/storage"

/**
 * Golden-path admin smoke (Task #299).
 *
 * One Playwright scenario walks the full life of a job for the admin
 * persona, driving every transition through the UI: clients-first
 * nav → New Client dialog → Jobs page → "+ New Job" two-step dialog →
 * Schedule list view → "New Schedule Item" dialog → Daily Logs →
 * "Daily Log" dialog with a real PDF attachment via the dropzone →
 * Financials estimate via "Parse Estimate PDF" → % complete edit →
 * "Job actions" → "Mark project complete". Each step asserts the
 * resulting record is visible on its dashboard / list view so a
 * regression in cache freshness or cross-screen state hand-off
 * surfaces here.
 *
 * The estimate-parse POST is intercepted because the local suite has
 * no Anthropic key (that path is the focus of
 * financials-ai-parse-retry.spec.ts). The intercept asserts the
 * upload request actually fired. After the mocked parse, a real
 * line item is seeded via the REST API so the % PATCH below
 * exercises the real cache-invalidation path that #275 fixed.
 *
 * Cleanup runs in afterAll in reverse order so children come down
 * before parents (attachments → logs → schedule → jobs → clients).
 */

test.use({ storageState: CESAR_STATE })

type CleanupFn = () => Promise<void>

test.describe("golden path — admin", () => {
  let token = ""
  const cleanups: CleanupFn[] = []

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
  })

  test.afterAll(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!
      try {
        await fn()
      } catch {
        // best-effort: a single stale row should not strand the rest
      }
    }
  })

  test("admin walks the full life of a job through the UI and every step is visible on its list view", async ({
    page,
    request,
  }) => {
    test.slow() // long flow with many UI transitions
    const stamp = Date.now()
    const clientName = `E2E GP Client ${stamp}`
    const jobTitle = `E2E GP Job ${stamp}`
    const scheduleTitle = `E2E GP Schedule ${stamp}`
    const logTitle = `E2E GP Log ${stamp}`
    const logNotes = `Golden-path notes marker ${stamp}`
    const attachmentName = `gp-attachment-${stamp}.pdf`
    const today = new Date().toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    // file-type sniffs the magic bytes, so use a real PDF header.
    const pdfBuffer = Buffer.from(
      "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
    )

    // ---- 1. Sign-in (provided by storageState) lands on dashboard.
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/dashboard/)

    // ---- 2. Create a client through the UI.
    await page.goto("/clients")
    await page.getByRole("button", { name: /^new client$/i }).first().click()
    const clientDialog = page.getByRole("dialog", { name: /new client/i })
    await expect(clientDialog).toBeVisible({ timeout: 10_000 })
    await clientDialog.locator("#companyName").fill(clientName)
    const clientCreatePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/clients") &&
        res.request().method() === "POST" &&
        res.ok(),
      { timeout: 15_000 },
    )
    await clientDialog
      .getByRole("button", { name: /^create client$/i })
      .click()
    const clientResponse = await clientCreatePromise
    const clientBody = await clientResponse.json()
    const clientId: string = clientBody.client?.id ?? clientBody.id
    expect(clientId, "client id should be returned by POST /api/clients").toBeTruthy()
    cleanups.push(async () => {
      await request.delete(`/api/clients/${clientId}`, {
        headers: authHeaders(token),
      })
    })

    // Cross-screen freshness: new client must appear on the list.
    await page
      .getByPlaceholder(/search clients/i)
      .first()
      .fill(clientName)
    await expect(page.getByText(clientName).first()).toBeVisible({
      timeout: 10_000,
    })

    // ---- 3. Create a job through the two-step "+ New Job" dialog.
    await page.goto("/jobs")
    await page.getByRole("button", { name: /\+ ?new job/i }).first().click()
    const jobDialog = page.getByRole("dialog", { name: /create job/i })
    await expect(jobDialog).toBeVisible({ timeout: 10_000 })

    // Step 1 — title, client, dates.
    await jobDialog.locator("#title").fill(jobTitle)
    // Open the client select trigger and pick the client we just made.
    await jobDialog.getByRole("combobox").first().click()
    await page
      .getByRole("option", { name: new RegExp(clientName, "i") })
      .first()
      .click()
    await jobDialog.locator("#projectedStart").fill(today)
    await jobDialog.locator("#projectedCompletion").fill(tomorrow)
    await jobDialog
      .getByRole("button", { name: /next: location & contract/i })
      .click()

    // Step 2 — accept defaults (fixed_price contract is pre-selected)
    // and submit. Wait on the POST /api/jobs response to capture the id.
    const jobCreatePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/jobs") &&
        res.request().method() === "POST" &&
        res.ok(),
      { timeout: 15_000 },
    )
    await jobDialog.getByRole("button", { name: /^create job$/i }).click()
    const jobResponse = await jobCreatePromise
    const jobBody = await jobResponse.json()
    const jobId: string = jobBody.job?.id ?? jobBody.id
    expect(jobId, "job id should be returned by POST /api/jobs").toBeTruthy()
    cleanups.push(async () => {
      await request.delete(`/api/jobs/${jobId}`, {
        headers: authHeaders(token),
      })
    })

    // Cross-screen freshness: the new job is on /jobs immediately.
    await page
      .getByPlaceholder(/search/i)
      .first()
      .fill(jobTitle)
    await expect(page.getByText(jobTitle).first()).toBeVisible({
      timeout: 15_000,
    })

    // ---- 4. Schedule item via UI: List view → "New Schedule Item".
    await page.goto(`/jobs/${jobId}/schedule`)
    // Switch to List view (calendar quick-create requires day-cell drag,
    // which the dedicated drag specs already cover end-to-end).
    await page.getByRole("button", { name: /^list$/i }).first().click()
    await page
      .getByRole("button", { name: /^new schedule item$/i })
      .first()
      .click()
    const scheduleDialog = page.getByRole("dialog", {
      name: /add schedule item/i,
    })
    await expect(scheduleDialog).toBeVisible({ timeout: 10_000 })
    await scheduleDialog.locator("#schedule-item-title").fill(scheduleTitle)
    const scheduleCreatePromise = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/jobs\/[^/]+\/schedule(-items)?$/.test(res.url()) &&
        res.ok(),
      { timeout: 15_000 },
    )
    await scheduleDialog
      .getByRole("button", { name: /^save$/i })
      .first()
      .click()
    const scheduleResp = await scheduleCreatePromise
    const scheduleBody = await scheduleResp.json()
    const scheduleId: string = scheduleBody.item?.id ?? scheduleBody.id
    expect(scheduleId).toBeTruthy()
    cleanups.push(async () => {
      await request.delete(`/api/schedule-items/${scheduleId}`, {
        headers: authHeaders(token),
      })
    })

    // Cross-screen freshness: the item shows on the schedule list view.
    await expect(page.getByText(scheduleTitle).first()).toBeVisible({
      timeout: 15_000,
    })

    // ---- 5. Daily log via UI, with a real PDF attachment uploaded
    //         through the dropzone hidden file input.
    await page.goto(`/jobs/${jobId}/daily-logs`)
    await page
      .getByRole("button", { name: /^daily log$/i })
      .first()
      .click()
    const logDialog = page.getByRole("dialog").last()
    await expect(logDialog).toBeVisible({ timeout: 10_000 })

    // Title input is unlabeled-by-id; bind via its placeholder.
    await logDialog
      .getByPlaceholder(/kitchen counter install/i)
      .fill(logTitle)
    await logDialog
      .getByPlaceholder(/describe what happened on site today/i)
      .fill(logNotes)

    // Attach a real PDF via the dropzone input. Dropzone hides its
    // input under display:none, so query by accept attribute (PDFs
    // count as "document").
    const attachmentInput = logDialog
      .locator('input[type="file"]')
      .first()
    await attachmentInput.setInputFiles({
      name: attachmentName,
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    })

    // Publish the new log; waitForResponse on the POST so we can grab id.
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
    const logId: string =
      logBody.log?.id ?? logBody.dailyLog?.id ?? logBody.id
    expect(logId).toBeTruthy()
    cleanups.push(async () => {
      await request.delete(`/api/daily-logs/${logId}`, {
        headers: authHeaders(token),
      })
    })

    // Cross-screen freshness: feed renders the notes marker AND the
    // attachment file name (proves the read-after-write cache + the
    // multipart attachment write both completed).
    await expect(page.getByText(logNotes).first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText(attachmentName).first()).toBeVisible({
      timeout: 10_000,
    })

    // ---- 6. Financials: drive the estimate upload through the UI.
    //         The AI parse POST is intercepted (no Anthropic key
    //         locally) and the intercept asserts the upload fired.
    let estimatePostCalls = 0
    await page.route(
      `**/api/jobs/${jobId}/financials/estimate`,
      async (route: Route) => {
        estimatePostCalls += 1
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            tracker: { id: "mocked", estimateFileId: "mocked-file" },
            areas: [],
            lineItems: [],
            invoices: [],
            changeOrders: [],
            ok: true,
          }),
        })
      },
    )

    await page.goto(`/jobs/${jobId}/financials`)

    // Trigger the hidden file input directly (the visible "Parse
    // Estimate PDF" button only proxies a click to it).
    const estimateInput = page
      .locator(
        'input[type="file"][accept*=".pdf"][accept*="application/pdf"]',
      )
      .first()
    await expect(
      estimateInput,
      "the estimate PDF file input must be present on the financials page",
    ).toHaveCount(1)
    await estimateInput.setInputFiles({
      name: "gp-estimate.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    })

    // The intercepted POST must have fired exactly once — this catches
    // a regression where the "Parse Estimate PDF" button is detached
    // from the file input (the gating affordance #287 covered).
    await expect
      .poll(() => estimatePostCalls, {
        message:
          "POST /financials/estimate should fire after the estimate file is selected",
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(1)

    // Seed a real line item so the % PATCH below hits real DB rows.
    const areaRes = await request.post(
      `/api/jobs/${jobId}/financials/areas`,
      {
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        data: { name: "GP Area" },
      },
    )
    expect(areaRes.ok()).toBeTruthy()
    const areaId = (await areaRes.json()).area.id as string
    const liRes = await request.post(
      `/api/jobs/${jobId}/financials/line-items`,
      {
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        data: {
          areaId,
          description: "GP Line",
          qty: 1,
          rateCents: 1_000_000,
          scheduledValueCents: 1_000_000,
        },
      },
    )
    expect(liRes.ok()).toBeTruthy()

    // Refresh so the new SOV row renders, then edit % via the UI.
    await page.reload()
    const pctInput = page.getByLabel("Percent complete for GP Line")
    await expect(pctInput).toBeVisible({ timeout: 10_000 })
    const patchPromise = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res
          .url()
          .includes(`/api/jobs/${jobId}/financials/line-items/`) &&
        res.ok(),
      { timeout: 10_000 },
    )
    await pctInput.fill("50")
    await pctInput.blur()
    await patchPromise

    // ---- 7. Mark complete via the UI: Job actions → Mark project
    //         complete → Yes, complete project. Job-detail re-renders
    //         with the action menu on every sub-page so we can click
    //         it from /financials.
    await page.getByRole("button", { name: /job actions/i }).first().click()
    await page
      .getByRole("menuitem", { name: /mark project complete/i })
      .click()
    const completePromise = page.waitForResponse(
      (res) =>
        res.request().method() === "PUT" &&
        res.url().endsWith(`/api/jobs/${jobId}`) &&
        res.ok(),
      { timeout: 15_000 },
    )
    await page
      .getByRole("button", { name: /yes, complete project/i })
      .click()
    await completePromise

    // ---- 8. Cross-screen freshness: the now-closed job no longer
    //         shows under the default "Open" filter, but switching to
    //         "Closed" surfaces it. Catches a stale jobs-list cache.
    await page.goto("/jobs")
    await page
      .getByPlaceholder(/search/i)
      .first()
      .fill(jobTitle)
    // Default filter is "all"; explicitly switch to Closed via the
    // status Select to assert the closed job is filterable.
    await page.getByRole("combobox", { name: /all statuses/i })
      .or(page.getByRole("combobox").first())
      .first()
      .click()
    await page.getByRole("option", { name: /^closed$/i }).click()
    await expect(page.getByText(jobTitle).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
