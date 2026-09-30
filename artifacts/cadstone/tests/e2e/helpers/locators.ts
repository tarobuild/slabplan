import type { Page } from "@playwright/test"

export function visiblePlaceholder(page: Page, placeholder: string | RegExp) {
  return page
    .getByPlaceholder(placeholder)
    .and(page.locator(":visible"))
    .and(page.locator(':not([placeholder="Global search"])'))
    .and(page.locator(':not([aria-label="Global search"])'))
    .first()
}

export function visibleText(page: Page, text: string | RegExp) {
  return page.getByText(text).and(page.locator(":visible")).first()
}
