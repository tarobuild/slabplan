import { expect, test } from "@playwright/test"
import { CESAR_STATE, WORKER_STATE } from "./helpers/storage"

/**
 * Settings shell (Task #320).
 *
 * The legacy `/settings` page was a single long scroll. It has been
 * split into a left-rail subnav with sub-routes:
 *   /settings/profile, /password, /notifications, /tokens
 *   /settings/team, /company, /integrations  (admin-only)
 *
 * Coverage:
 *  - `/settings` redirects to `/settings/profile`.
 *  - `/settings/users` permanently redirects to `/settings/team`.
 *  - Admin sees admin-only rail items; clicking changes the URL and
 *    the panel content updates.
 *  - Crew member does not see admin items, and visiting an admin
 *    sub-route is bounced back to `/settings/profile`.
 *  - Arrow keys move focus between rail items (looping).
 */

test.describe("settings shell — admin", () => {
  test.use({ storageState: CESAR_STATE })

  test("/settings redirects to /settings/profile and rail nav swaps panel", async ({
    page,
  }) => {
    await page.goto("/settings")
    await expect(page).toHaveURL(/\/settings\/profile$/)

    // Profile panel is rendered.
    await expect(
      page.getByRole("heading", { name: /^profile$/i }),
    ).toBeVisible({ timeout: 15_000 })

    // Admin sees admin-only rail items.
    const rail = page.getByRole("complementary", { name: /settings sections/i })
    await expect(rail.getByRole("link", { name: /^team$/i })).toBeVisible()
    await expect(rail.getByRole("link", { name: /^company$/i })).toBeVisible()
    await expect(
      rail.getByRole("link", { name: /^integrations$/i }),
    ).toBeVisible()

    // Click Notifications → URL + panel update.
    await rail.getByRole("link", { name: /^notifications$/i }).click()
    await expect(page).toHaveURL(/\/settings\/notifications$/)
    await expect(
      page.getByRole("heading", { name: /^notifications$/i }),
    ).toBeVisible()

    // Click Team → admin sub-route renders Users page.
    await rail.getByRole("link", { name: /^team$/i }).click()
    await expect(page).toHaveURL(/\/settings\/team$/)
  })

  test("legacy /settings/users redirects to /settings/team", async ({
    page,
  }) => {
    await page.goto("/settings/users")
    await expect(page).toHaveURL(/\/settings\/team$/)
  })

  test("password sub-route renders the change-password form with client-side mismatch validation", async ({
    page,
  }) => {
    await page.goto("/settings/password")
    await expect(
      page.getByRole("heading", { name: /change password/i }),
    ).toBeVisible({ timeout: 15_000 })

    const current = page.locator("#current-password")
    const next = page.locator("#new-password")
    const confirm = page.locator("#confirm-password")
    await expect(current).toBeVisible()
    await expect(next).toBeVisible()
    await expect(confirm).toBeVisible()

    // Fill mismatched values; client-side check should surface inline
    // text without firing a network request.
    await current.fill("whatever-current")
    await next.fill("Brand-new-pw-12345")
    await confirm.fill("Brand-new-pw-67890")
    await expect(page.getByText(/passwords do not match/i)).toBeVisible()
  })

  test("tokens sub-route can create and revoke a personal access token", async ({
    page,
  }) => {
    await page.goto("/settings/tokens")
    await expect(
      page.getByRole("heading", { name: /api access tokens/i }),
    ).toBeVisible({ timeout: 15_000 })

    const tokenName = `e2e-shell-${Date.now()}`
    await page.locator("#token-name").fill(tokenName)
    await page.getByRole("button", { name: /create token/i }).click()

    // Reveal panel shows the freshly minted secret once.
    await expect(
      page.getByText(/copy this token now/i),
    ).toBeVisible({ timeout: 15_000 })

    // The token row appears in the existing-tokens table as Active.
    const row = page.locator("tr", { hasText: tokenName })
    await expect(row).toBeVisible()
    await expect(row.getByText(/^active$/i)).toBeVisible()

    // Revoke via the per-row trash button. The revoke confirm() is auto-accepted.
    page.once("dialog", (d) => d.accept())
    await row.getByRole("button", { name: new RegExp(`revoke ${tokenName}`, "i") }).click()

    await expect(row.getByText(/^revoked$/i)).toBeVisible({ timeout: 15_000 })
  })

  test("arrow keys move focus between rail items", async ({ page }) => {
    await page.goto("/settings/profile")
    const rail = page.getByRole("complementary", { name: /settings sections/i })
    const profileLink = rail.getByRole("link", { name: /^profile$/i })
    await profileLink.focus()
    await expect(profileLink).toBeFocused()

    await page.keyboard.press("ArrowDown")
    await expect(
      rail.getByRole("link", { name: /^password$/i }),
    ).toBeFocused()

    await page.keyboard.press("ArrowUp")
    await expect(profileLink).toBeFocused()
  })
})

test.describe("settings shell — crew member", () => {
  test.use({ storageState: WORKER_STATE })

  test("crew does not see admin rail items", async ({ page }) => {
    await page.goto("/settings/profile")
    await expect(
      page.getByRole("heading", { name: /^profile$/i }),
    ).toBeVisible({ timeout: 15_000 })

    const rail = page.getByRole("complementary", { name: /settings sections/i })
    await expect(rail.getByRole("link", { name: /^profile$/i })).toBeVisible()
    await expect(rail.getByRole("link", { name: /^team$/i })).toHaveCount(0)
    await expect(rail.getByRole("link", { name: /^company$/i })).toHaveCount(0)
    await expect(
      rail.getByRole("link", { name: /^integrations$/i }),
    ).toHaveCount(0)
  })

  test("crew visiting admin sub-route is bounced to /settings/profile", async ({
    page,
  }) => {
    await page.goto("/settings/company")
    await expect(page).toHaveURL(/\/settings\/profile$/)
  })
})
