import { expect, test, type Page } from "@playwright/test"
import { CESAR_STATE, PM_STATE, WORKER_STATE } from "./helpers/storage"

/**
 * Home page role routing (Task #334).
 *
 * The role-aware Home page (Task #321) replaced the one-size-fits-all
 * dashboard with three distinct layouts (Crew "My Day", PM "This
 * Week", Admin "Business Pulse"). Unit tests cover the at-risk
 * classifiers, but nothing proves end-to-end that each role actually
 * lands on its correct layout when they navigate to `/dashboard`, while `/`
 * remains the public marketing page. A regression in routing, role detection,
 * or the discriminated-union API response could silently flip a crew user into
 * the admin layout (or vice versa). This spec catches that.
 *
 * One test per role. Each test:
 *   - verifies `/` remains the public marketing page
 *   - visits `/dashboard`
 *   - asserts the role's top-level testid renders
 *     (`home-my-day` | `home-pm` | `home-admin`)
 *   - asserts at least one role-specific child element is present so
 *     a regression that renders the right wrapper but the wrong
 *     payload still fails here.
 */

async function assertCrewHome(page: Page) {
  await expect(page.getByTestId("home-my-day")).toBeVisible({
    timeout: 15_000,
  })
  // Wrong-role layouts must not also be present.
  await expect(page.getByTestId("home-pm")).toHaveCount(0)
  await expect(page.getByTestId("home-admin")).toHaveCount(0)
  // Crew-specific child: a schedule item row when there is one, or
  // the unconditional "Today's schedule" heading when the day is
  // empty. Either proves the My Day tree (not the PM/admin tree)
  // actually rendered.
  await expect(
    page
      .getByTestId("home-schedule-item")
      .first()
      .or(page.getByText(/today's schedule/i).first()),
  ).toBeVisible({ timeout: 10_000 })
}

async function assertPmHome(page: Page) {
  await expect(page.getByTestId("home-pm")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("home-my-day")).toHaveCount(0)
  await expect(page.getByTestId("home-admin")).toHaveCount(0)
  await expect(page.getByTestId("home-pm-at-risk-overdue")).toBeVisible({
    timeout: 10_000,
  })
}

async function assertAdminHome(page: Page) {
  await expect(page.getByTestId("home-admin")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("home-my-day")).toHaveCount(0)
  await expect(page.getByTestId("home-pm")).toHaveCount(0)
  await expect(page.getByTestId("home-admin-kpi-ar")).toBeVisible({
    timeout: 10_000,
  })
}

async function assertPublicHome(page: Page) {
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /from first measure to final payment/i,
    }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("home-my-day")).toHaveCount(0)
  await expect(page.getByTestId("home-pm")).toHaveCount(0)
  await expect(page.getByTestId("home-admin")).toHaveCount(0)
}

test.describe("home routing — crew sees My Day in the app", () => {
  test.use({ storageState: WORKER_STATE })

  test("crew sees the public homepage and lands on My Day in the app", async ({
    page,
  }) => {
    await page.goto("/")
    await assertPublicHome(page)

    await page.goto("/dashboard")
    await assertCrewHome(page)
  })
})

test.describe("home routing — PM sees This Week in the app", () => {
  test.use({ storageState: PM_STATE })

  test("PM sees the public homepage and lands on This Week in the app", async ({
    page,
  }) => {
    await page.goto("/")
    await assertPublicHome(page)

    await page.goto("/dashboard")
    await assertPmHome(page)
  })
})

test.describe("home routing — admin sees Business Pulse in the app", () => {
  test.use({ storageState: CESAR_STATE })

  test(
    "admin sees the public homepage and lands on Business Pulse in the app",
    async ({ page }) => {
      await page.goto("/")
      await assertPublicHome(page)

      await page.goto("/dashboard")
      await assertAdminHome(page)
    },
  )
})
