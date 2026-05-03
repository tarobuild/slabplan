import { defineConfig, devices } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:21903"
// On Nix-based Replit hosts the Playwright-bundled chromium can't find
// its shared libraries (libglib-2.0, libnss3, ...). Point at the system
// chromium via CHROMIUM_PATH when set; otherwise fall back to the
// bundled binary so the config stays usable off-host.
const chromiumExecutable = process.env.CHROMIUM_PATH

/**
 * Critical-path e2e suite for CAD Stone Networks.
 *
 * Assumes:
 * - API server (artifacts/api-server) is already running on :8080
 * - Vite dev server (artifacts/cadstone) is already running on :21903
 * - The local DB has been seeded with both users AND baseline fixtures
 *   (see "Seeding the local DB" below). Most specs call
 *   `requireAnyJob` / `requireAnyClient` from helpers/api.ts in
 *   beforeAll and will FAIL LOUDLY (not silently skip) if the fixture
 *   client + open job are missing. Re-run the seed if that happens.
 *
 * Seeding the local DB:
 *   pnpm setup-test-db   # recreate schema (drops + recreates the DB)
 *   SEED_ADMIN_CESAR_PASSWORD=... \
 *     SEED_ADMIN_ANWAR_PASSWORD=... \
 *     SEED_WORKER_FIXTURE_PASSWORD=... \
 *     node artifacts/api-server/scripts/seed-users.mjs --db=local
 *
 * That single seed-users.mjs invocation upserts:
 *   cesar@cadstone.works   (admin)
 *   anwar@cadstone.works   (admin) — Anwar is an admin in reality; he
 *                                    and Cesar invite workers.
 *   worker@cadstone.works  (crew_member) — synthetic fixture used to
 *                                          prove worker-level role
 *                                          gates actually fire. Local
 *                                          only — production never
 *                                          seeds it. The Playwright
 *                                          helpers also read
 *                                          SEED_WORKER_FIXTURE_PASSWORD
 *                                          so the seed-time and
 *                                          login-time passwords match.
 *   "E2E Fixture Client"   — baseline client the suite attaches new
 *                            jobs to via requireAnyClient.
 *   "E2E Fixture Job"      — baseline open job the suite reads via
 *                            requireAnyJob. Without these two rows
 *                            most of the spec files would hard-fail
 *                            in beforeAll on a fresh DB.
 *
 * See the seed-users.mjs header for password hardening rules and the
 * production flow.
 *
 * The `setup` project logs all four users in once and persists their
 * sessions to tests/e2e/.auth/{cesar,anwar,worker,pm}.json. Specs that
 * need an authenticated starting point read that storageState instead
 * of clicking through the login form — otherwise the auth rate limiter
 * (5/email/10min) would trip before the suite finishes.
 *
 * The fourth fixture — `pm.json` — backs `fixture-pm@cadstone.test`,
 * a synthetic project_manager used to drive PM-positive flows in
 * `golden-path-pm.spec.ts` (PM-of-job CAN edit own job, manage
 * schedule, view financials). Unlike the other three users, the PM
 * is NOT seeded by seed-users.mjs because production has no PMs by
 * default. Instead `auth.setup.ts` provisions it on demand: it logs
 * in as Cesar, calls `ensureProjectManagerFixture` to invite
 * `fixture-pm@cadstone.test` if missing, reissues a fresh invite
 * token, and consumes it via /auth/accept-invite to (re)set the
 * password to SEED_PM_FIXTURE_PASSWORD. That env var is REQUIRED by
 * the suite — pick any password that satisfies the API policy
 * (>= 12 chars, no obvious weak patterns).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  outputDir: path.join(here, "test-results"),
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL,
        ...(chromiumExecutable
          ? { launchOptions: { executablePath: chromiumExecutable } }
          : {}),
      },
    },
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        baseURL,
        ...(chromiumExecutable
          ? { launchOptions: { executablePath: chromiumExecutable } }
          : {}),
      },
    },
    // Mobile (iPhone 13) variant of the golden-path smoke. Foremen and
    // crew use the app from their phones, where the layout switches to
    // a hamburger drawer + sheet-based search and the desktop top nav
    // is hidden (see `lg:hidden` / `hidden lg:flex` rules in TopNav).
    // This project re-runs ONLY the golden-path specs at an iPhone-
    // sized viewport with hasTouch so layout / tap-target / drawer
    // regressions surface before they reach the field. Per-spec
    // mobile branches assert mobile-specific selectors (hamburger
    // visibility, drawer-driven navigation) instead of duplicating
    // the entire scenario.
    {
      name: "mobile-chromium",
      testMatch: /golden-path-.*\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["iPhone 13"],
        baseURL,
        ...(chromiumExecutable
          ? { launchOptions: { executablePath: chromiumExecutable } }
          : {}),
      },
    },
  ],
})
