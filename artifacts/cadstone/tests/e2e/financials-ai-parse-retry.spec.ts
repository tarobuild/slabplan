import { expect, test, type Route } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import {
  createCustomJob,
  deleteJob,
  requireAnyClient,
} from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

// Round-8 follow-up coverage for the inline "Try again" alert that
// shows up under the Estimate / Invoices cards on Job Financials when
// an AI parse blows up (state lives in `estimateError` / `invoiceError`
// in src/pages/job-financials.tsx). The backend log behaviour is
// covered by artifacts/api-server/test/financials.test.ts; what those
// tests can't catch is the UI retry path itself, plus the
// percentComplete safety confirm that fires when an SOV % edit would
// silently shrink billed below already-matched invoice payments.
//
// We mock the estimate POST + tracker GET via page.route() rather than
// driving the real Anthropic call: the suite has no AI key configured
// locally, and we want a deterministic 500-then-200 sequence.

test.use({ storageState: CESAR_STATE })

type LinePayment = { id: string; invoiceId: string; amountCents: number }
type LineItem = {
  id: string
  areaId: string
  description: string
  qty: string
  rateCents: number
  scheduledValueCents: number
  billedCents: number
  percentComplete: string
  isRemoved: boolean
  isChangeOrder: boolean
  sortOrder: number
  payments: LinePayment[]
}
type Area = {
  id: string
  trackerId: string
  name: string
  floor: string | null
  sortOrder: number
  isChangeOrderGroup: boolean
  lineItems: LineItem[]
}
type Invoice = {
  id: string
  invoiceNumber: string | null
  invoiceDate: string | null
  totalCents: number
  appliedAt: string | null
  createdAt: string
  fileId: string | null
  payments: { id: string; lineItemId: string; amountCents: number }[]
}
type TrackerData = {
  tracker: {
    id: string
    jobId: string
    projectName: string | null
    contractDate: string | null
    currency: string
    estimateFileId: string | null
  }
  clientId: string | null
  areas: Area[]
  changeOrders: unknown[]
  invoices: Invoice[]
  totals: {
    scheduledValueCents: number
    billedCents: number
    outstandingCents: number
    changeOrderApprovedCents: number
    contractWithChangesCents: number
    percentBilled: number
  }
}

function buildTracker(opts: {
  jobId: string
  trackerId?: string
  areas?: Area[]
  invoices?: Invoice[]
  estimateFileId?: string | null
}): TrackerData {
  const trackerId = opts.trackerId ?? "tracker-mock"
  const areas = opts.areas ?? []
  const invoices = opts.invoices ?? []
  const sched = areas.reduce(
    (s, a) => s + a.lineItems.reduce((x, l) => x + l.scheduledValueCents, 0),
    0,
  )
  const billed = areas.reduce(
    (s, a) => s + a.lineItems.reduce((x, l) => x + l.billedCents, 0),
    0,
  )
  return {
    tracker: {
      id: trackerId,
      jobId: opts.jobId,
      projectName: null,
      contractDate: null,
      currency: "USD",
      estimateFileId: opts.estimateFileId ?? null,
    },
    clientId: null,
    areas,
    changeOrders: [],
    invoices,
    totals: {
      scheduledValueCents: sched,
      billedCents: billed,
      outstandingCents: Math.max(0, sched - billed),
      changeOrderApprovedCents: 0,
      contractWithChangesCents: sched,
      percentBilled: sched > 0 ? Math.round((billed / sched) * 100) : 0,
    },
  }
}

test.describe("financials → AI parse error retry", () => {
  let token = ""
  let clientId = ""
  let createdJobId: string | null = null

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
    clientId = await requireAnyClient(request, token)
  })

  test.afterEach(async ({ request }) => {
    if (createdJobId) {
      await deleteJob(request, token, createdJobId)
      createdJobId = null
    }
  })

  test('"Try again" re-runs the estimate parse and populates the SOV after a 500', async ({
    page,
    request,
  }) => {
    const title = `E2E ai-parse retry ${Date.now()}`
    createdJobId = await createCustomJob(request, token, { title, clientId })
    const jobId = createdJobId

    // Lazy-create the tracker so the real GET returns a stable empty
    // shell; the mocked POST will replace it on success.
    const initRes = await request.get(`/api/jobs/${jobId}/financials`, {
      headers: authHeaders(token),
    })
    expect(initRes.ok()).toBeTruthy()

    // Sequence the mock: first POST → 500 with an AI_PARSE_FAILED code
    // surfaced via problem+json `errors.code` (the exact shape
    // apiErrorDetailCode reads). Second POST → 200 with a populated
    // single-area / single-line-item tracker so the row becomes
    // discoverable by its Percent-complete aria-label.
    let postCalls = 0
    await page.route(
      `**/api/jobs/${jobId}/financials/estimate`,
      async (route: Route) => {
        postCalls += 1
        if (postCalls === 1) {
          await route.fulfill({
            status: 500,
            contentType: "application/problem+json",
            body: JSON.stringify({
              message: "AI returned no text.",
              errors: { code: "AI_PARSE_FAILED" },
            }),
          })
          return
        }
        const successTracker = buildTracker({
          jobId,
          trackerId: "tracker-mock",
          estimateFileId: "file-mock",
          areas: [
            {
              id: "area-mock",
              trackerId: "tracker-mock",
              name: "AI Area",
              floor: null,
              sortOrder: 0,
              isChangeOrderGroup: false,
              lineItems: [
                {
                  id: "line-mock",
                  areaId: "area-mock",
                  description: "AI Parsed Item",
                  qty: "1",
                  rateCents: 100_000,
                  scheduledValueCents: 100_000,
                  billedCents: 0,
                  percentComplete: "0",
                  isRemoved: false,
                  isChangeOrder: false,
                  sortOrder: 0,
                  payments: [],
                },
              ],
            },
          ],
        })
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(successTracker),
        })
      },
    )

    await page.goto(`/jobs/${jobId}/financials`)

    // The estimate file input is rendered with the `hidden` attribute;
    // setInputFiles works on hidden inputs.
    const fileInput = page.locator(
      'input[type="file"][accept*="application/pdf"]',
    ).first()
    await fileInput.setInputFiles({
      name: "broken-estimate.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 not a real pdf\n"),
    })

    // 1. Orange banner appears with file name + machine-readable code.
    const banner = page.getByRole("alert").filter({
      hasText: /Couldn.t parse broken-estimate\.pdf/i,
    })
    await expect(banner).toBeVisible({ timeout: 10_000 })
    await expect(banner).toContainText("AI_PARSE_FAILED")

    // 2. Retry. The second call returns the mocked tracker; the SOV
    //    should populate with a row labelled "AI Parsed Item".
    await banner.getByRole("button", { name: /try again/i }).click()

    await expect(
      page.getByLabel("Percent complete for AI Parsed Item"),
    ).toBeVisible({ timeout: 10_000 })
    expect(postCalls).toBe(2)

    // 3. The error banner is cleared after the successful retry
    //    (estimateError → null in performEstimateUpload).
    await expect(banner).toHaveCount(0)
  })

  test("lowering % below applied invoice payments triggers a confirm naming the invoices", async ({
    page,
    request,
  }) => {
    const title = `E2E pct-confirm ${Date.now()}`
    createdJobId = await createCustomJob(request, token, { title, clientId })
    const jobId = createdJobId

    // Mock GET /financials to return a tracker where the only line
    // item is fully billed by an invoice with a known invoice number.
    // Driving this via real DB rows would require an AI-backed invoice
    // upload (no plain-create endpoint exists), so we stub the read
    // and let the page render a deterministic line + invoice.
    const lineItemId = "line-paid"
    const invoiceId = "inv-paid"
    const invoiceNumber = "INV-9999"
    const tracker = buildTracker({
      jobId,
      trackerId: "tracker-paid",
      areas: [
        {
          id: "area-paid",
          trackerId: "tracker-paid",
          name: "Paid Area",
          floor: null,
          sortOrder: 0,
          isChangeOrderGroup: false,
          lineItems: [
            {
              id: lineItemId,
              areaId: "area-paid",
              description: "Fully Billed Line",
              qty: "1",
              rateCents: 500_000,
              scheduledValueCents: 500_000,
              billedCents: 500_000,
              percentComplete: "100",
              isRemoved: false,
              isChangeOrder: false,
              sortOrder: 0,
              payments: [
                { id: "pay-1", invoiceId, amountCents: 500_000 },
              ],
            },
          ],
        },
      ],
      invoices: [
        {
          id: invoiceId,
          invoiceNumber,
          invoiceDate: "2025-01-15",
          totalCents: 500_000,
          appliedAt: "2025-01-15T00:00:00.000Z",
          createdAt: "2025-01-15T00:00:00.000Z",
          fileId: null,
          payments: [
            { id: "pay-1", lineItemId, amountCents: 500_000 },
          ],
        },
      ],
    })

    await page.route(
      `**/api/jobs/${jobId}/financials`,
      async (route: Route) => {
        if (route.request().method() !== "GET") {
          await route.fallback()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(tracker),
        })
      },
    )

    // Capture the confirm() message and dismiss to keep the value at
    // 100. The PATCH must NOT fire if dismissed, so we also watch for
    // any unexpected line-item PATCH and fail loudly if one slips out.
    const dialogs: string[] = []
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message())
      await dialog.dismiss()
    })

    let unexpectedPatch = false
    await page.route(
      `**/api/jobs/${jobId}/financials/line-items/**`,
      async (route: Route) => {
        if (route.request().method() === "PATCH") {
          unexpectedPatch = true
        }
        await route.fallback()
      },
    )

    await page.goto(`/jobs/${jobId}/financials`)

    const pctInput = page.getByLabel("Percent complete for Fully Billed Line")
    await expect(pctInput).toBeVisible({ timeout: 10_000 })

    // Lower 100 → 50; with $5,000 scheduled and $5,000 already applied,
    // the safety predicate (describePercentLowering) should report a
    // conflict and trigger window.confirm.
    await pctInput.fill("50")
    await pctInput.blur()

    await expect
      .poll(() => dialogs.length, { timeout: 5_000 })
      .toBeGreaterThan(0)
    const message = dialogs[0]
    expect(message).toContain(invoiceNumber)
    expect(message).toMatch(/already has/i)
    expect(message).toMatch(/50%/)
    expect(unexpectedPatch).toBe(false)
  })
})
