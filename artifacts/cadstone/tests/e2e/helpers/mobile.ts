import { expect, type Page } from "@playwright/test"

/**
 * Mobile-viewport helpers for the golden-path specs.
 *
 * Post-#318 the app renders a fixed bottom-tab navigator
 * below the Tailwind `md` breakpoint (768px) instead of a hamburger
 * drawer. The bottom nav surfaces 4 role-based tabs + a "More" sheet
 * (Crew: Home·My Jobs·Logs·More; Admin/PM: Home·Clients·Schedule·
 * More). The desktop top nav reappears at `md:flex`.
 *
 * The golden-path specs run at both Desktop Chrome (>= md) and the
 * `mobile-chromium` Playwright project (iPhone 13, 390px). These
 * helpers branch on viewport width so the same scenario covers both
 * code paths without forking the spec.
 */

const MD_BREAKPOINT_PX = 768

export function isMobileViewport(page: Page): boolean {
  const size = page.viewportSize()
  return Boolean(size && size.width < MD_BREAKPOINT_PX)
}

/**
 * On mobile, asserts the bottom-tab nav is visible (and the desktop
 * top-nav links are hidden), then taps the matching tab via its
 * `aria-label`. Falls back to a plain `page.goto` on desktop.
 *
 * `linkName` should match a bottom-tab `aria-label` such as `/clients/i`
 * or `/my jobs/i`. Items only available under the "More" sheet (e.g.
 * Resources) need a different helper — this one only navigates between
 * top-level tabs.
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

  // Mobile-specific assertions: the bottom-tab nav MUST be visible and
  // the desktop primary nav (`hidden md:flex`) MUST be hidden. Catches
  // a regression where the breakpoints get inverted or removed.
  const bottomNav = page.getByRole("navigation", { name: /primary mobile/i })
  await expect(
    bottomNav,
    "bottom-tab nav must be visible at mobile widths",
  ).toBeVisible()

  await bottomNav.getByRole("link", { name: linkName }).first().click()
  await expect(page).toHaveURL(new RegExp(href.replace(/\//g, "\\/")))
}
