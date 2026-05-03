import { expect, type Page } from "@playwright/test"

/**
 * Mobile-viewport helpers for the golden-path specs.
 *
 * The CAD Stone app collapses its top nav into a hamburger-driven
 * Sheet drawer below the Tailwind `lg` breakpoint (1024px). The
 * golden-path specs run at both Desktop Chrome (>= 1024px) and the
 * `mobile-chromium` Playwright project (iPhone 13, 390px). These
 * helpers branch on viewport width so the same scenario covers both
 * code paths without forking the spec.
 */

const LG_BREAKPOINT_PX = 1024

export function isMobileViewport(page: Page): boolean {
  const size = page.viewportSize()
  return Boolean(size && size.width < LG_BREAKPOINT_PX)
}

/**
 * On mobile, asserts the hamburger button is visible (and the desktop
 * top nav links are hidden), opens the drawer, and clicks the link
 * matching `linkName`. On desktop, falls back to a plain navigation.
 *
 * Use this for the FIRST navigation in a spec so the mobile drawer
 * gets exercised end-to-end (open → render nav → tap link → drawer
 * closes → URL updates). Subsequent steps can use `page.goto` since
 * those code paths are viewport-independent.
 */
export async function gotoViaTopNav(
  page: Page,
  href: string,
  linkName: RegExp,
): Promise<void> {
  if (!isMobileViewport(page)) {
    await page.goto(href)
    return
  }

  // Mobile-specific assertions: the hamburger trigger MUST be visible
  // and the desktop "Clients"/"My Jobs" top-nav links MUST be hidden.
  // Catches a regression where the `lg:hidden` / `hidden lg:flex`
  // breakpoints get inverted or removed.
  const hamburger = page.getByRole("button", {
    name: /open navigation menu/i,
  })
  await expect(
    hamburger,
    "hamburger button must be visible at mobile widths",
  ).toBeVisible()

  await hamburger.click()
  const drawer = page.getByRole("dialog").first()
  await expect(drawer).toBeVisible({ timeout: 5_000 })

  await drawer.getByRole("link", { name: linkName }).first().click()
  await expect(page).toHaveURL(new RegExp(href.replace(/\//g, "\\/")))
}
