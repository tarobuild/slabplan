import { expect, test, type Route } from "@playwright/test"
import { CESAR, loginViaApi } from "./helpers/auth"
import {
  createCustomJob,
  deleteJob,
  requireAnyClient,
} from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

// Coverage for the AI-parsed "Upload CO" flow on Job Financials
// (task #357). The page POSTs the file to
// /jobs/:jobId/financials/change-orders/parse, opens a confirm dialog
// pre-filled with {number, description, amountCents}, then on save
// calls the existing /change-orders endpoint to insert the pending row.
//
// We mock the parse + change-orders endpoints so the suite is
// deterministic and does not need an Anthropic key. The error retry
// path mirrors the estimate flow and is exercised here too.

test.use({ storageState: CESAR_STATE })

test.describe("financials → Upload CO", () => {
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

  test("parses a CO doc, opens confirm dialog, and creates a pending CO on save", async ({
    page,
    request,
  }) => {
    const title = `E2E co-upload ${Date.now()}`
    createdJobId = await createCustomJob(request, token, { title, clientId })
    const jobId = createdJobId

    // First parse 500s, then 200s — same pattern as the estimate
    // retry test, ensures the orange "Try again" banner round-trips.
    let parseCalls = 0
    await page.route(
      `**/api/jobs/${jobId}/financials/change-orders/parse`,
      async (route: Route) => {
        parseCalls += 1
        if (parseCalls === 1) {
          await route.fulfill({
            status: 502,
            contentType: "application/problem+json",
            body: JSON.stringify({
              message: "AI returned no text.",
              errors: { code: "AI_PARSE_FAILED" },
            }),
          })
          return
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            number: "CO-042",
            description: "Add granite backsplash, wing B",
            amountCents: 125_000,
            fileId: "file-mock",
          }),
        })
      },
    )

    // Capture the change-orders POST payload to assert correct shape.
    let coPostBody: Record<string, unknown> | null = null
    await page.route(
      `**/api/jobs/${jobId}/financials/change-orders`,
      async (route: Route) => {
        if (route.request().method() !== "POST") {
          await route.fallback()
          return
        }
        try {
          coPostBody = route.request().postDataJSON() as Record<
            string,
            unknown
          >
        } catch {
          coPostBody = null
        }
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ changeOrder: { id: "co-mock" } }),
        })
      },
    )

    await page.goto(`/jobs/${jobId}/financials`)

    // The Change Orders card has the visible Upload CO button + a
    // hidden file input. Pick the only `accept`-matching input.
    await expect(
      page.getByRole("button", { name: /upload co/i }).first(),
    ).toBeVisible({ timeout: 10_000 })

    const fileInputs = page.locator(
      'input[type="file"][accept*="application/pdf"]',
    )
    // First file input is the estimate's; second is the CO upload.
    const coInput = fileInputs.nth(1)
    await coInput.setInputFiles({
      name: "co-broken.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 broken\n"),
    })

    // Banner should appear and let us retry without re-picking.
    const banner = page.getByRole("alert").filter({
      hasText: /Couldn.t parse co-broken\.pdf/i,
    })
    await expect(banner).toBeVisible({ timeout: 10_000 })
    await expect(banner).toContainText("AI_PARSE_FAILED")
    await banner.getByRole("button", { name: /try again/i }).click()

    // Confirm dialog opens pre-filled with extracted values.
    const dialog = page.getByRole("dialog").filter({
      hasText: /Confirm change order/i,
    })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    const numberInput = dialog.getByLabel("CO #")
    const amountInput = dialog.getByLabel("Amount (USD)")
    const descInput = dialog.getByLabel("Description")
    await expect(numberInput).toHaveValue("CO-042")
    await expect(amountInput).toHaveValue("1250.00")
    await expect(descInput).toHaveValue("Add granite backsplash, wing B")

    // Edit the description and save.
    await descInput.fill("Add granite backsplash, wing B (revised)")
    await dialog.getByRole("button", { name: /save change order/i }).click()

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    expect(parseCalls).toBe(2)
    expect(coPostBody).toMatchObject({
      number: "CO-042",
      description: "Add granite backsplash, wing B (revised)",
      amountCents: 125_000,
      areaId: null,
    })
  })
})
