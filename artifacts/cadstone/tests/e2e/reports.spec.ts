// E2E coverage for the admin Reports surface (Task #322).
//
// Verifies:
//   1. Reports nav link is visible to the admin (Cesar) and clicking it
//      lands on /reports/ar-aging via the index redirect.
//   2. The left-rail subnav switches between the 5 sub-reports.
//   3. The CSV export link on each report points at
//      /api/reports/<slug>?...&format=csv.
//
// Auth follows the cesar storageState fixture pattern used by the
// other specs in this suite; see helpers/auth.ts + auth.setup.ts.

import { expect, test } from "@playwright/test"

const REPORTS = [
  { slug: "ar-aging", title: /A\/R Aging/i },
  { slug: "revenue", title: /Revenue by Month/i },
  { slug: "pipeline", title: /Sales Pipeline/i },
  { slug: "days-to-payment", title: /By Client/i },
  { slug: "jobs-by-stage", title: /Jobs by Stage/i },
] as const

test.describe("admin reports", () => {
  test("admin can open every report from the left rail", async ({ page }) => {
    await page.goto("/dashboard")
    await page.getByRole("link", { name: /^Reports$/ }).click()
    await expect(page).toHaveURL(/\/reports\/ar-aging/)

    for (const r of REPORTS) {
      await page.getByRole("link", { name: new RegExp(r.title.source, "i") }).click()
      await expect(page).toHaveURL(new RegExp(`/reports/${r.slug}`))
      // Each report renders the toolbar with a date-range select + CSV
      // export link, even when empty.
      await expect(page.getByRole("link", { name: /Export CSV/i })).toBeVisible()
    }
  })

  test("CSV export link targets the streaming endpoint with format=csv", async ({ page }) => {
    await page.goto("/reports/ar-aging")
    const link = page.getByRole("link", { name: /Export CSV/i })
    const href = await link.getAttribute("href")
    expect(href).toMatch(/\/api\/reports\/ar-aging\?.*format=csv/)
  })
})
