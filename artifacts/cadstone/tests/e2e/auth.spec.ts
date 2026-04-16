import { expect, test } from "@playwright/test"
import fs from "node:fs"
import { CESAR } from "./helpers/auth"
import { CESAR_STATE } from "./helpers/storage"

// This spec exercises unauthenticated starting state explicitly, so it
// opts out of the shared storageState fixture.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe("auth", () => {
  test("a refresh cookie alone bootstraps the session and survives reload", async ({
    page,
    context,
  }) => {
    // Reuse the refresh cookie provisioned by auth.setup.ts so we don't
    // have to call /auth/login (rate-limited at 5/email/10min).
    const state = JSON.parse(fs.readFileSync(CESAR_STATE, "utf8")) as {
      cookies?: Array<{
        name: string
        value: string
        domain?: string
        path?: string
        expires?: number
        httpOnly?: boolean
        secure?: boolean
        sameSite?: "Strict" | "Lax" | "None"
      }>
    }
    const refresh = state.cookies?.find(
      (c) => c.name === "cadstone_refresh_token",
    )
    test.skip(!refresh, "auth.setup must run before auth.spec")

    // Playwright's addCookies requires either `url` or `domain`+`path`.
    // The saved state gives us a domain (e.g. "localhost"), so use that
    // form — `page.url()` is still "about:blank" before first navigation
    // and would fail the cookie's URL validation.
    await context.addCookies([
      {
        name: refresh!.name,
        value: refresh!.value,
        domain: refresh!.domain ?? "localhost",
        path: refresh!.path ?? "/",
        expires: refresh!.expires ?? -1,
        httpOnly: refresh!.httpOnly ?? true,
        secure: refresh!.secure ?? false,
        sameSite: refresh!.sameSite ?? "Lax",
      },
    ])

    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/dashboard/)

    // Session survives a hard reload because bootstrapAuthSession calls
    // /auth/refresh on mount using the httpOnly refresh cookie.
    await page.reload()
    await expect(page).toHaveURL(/\/dashboard/)

    // Clearing cookies simulates a logout; /dashboard should bounce to /login.
    await context.clearCookies()
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/login/)
  })

  test("rejects invalid credentials and keeps the user on /login", async ({
    page,
  }) => {
    await page.goto("/login")
    await page.getByLabel(/email/i).fill(CESAR.email)
    await page.getByLabel(/password/i).fill("obviously-wrong-password")
    await page.getByRole("button", { name: /sign in/i }).click()

    // Give the rejection a moment to surface. URL must NOT advance.
    await page.waitForTimeout(1500)
    await expect(page).toHaveURL(/\/login/)
  })
})
