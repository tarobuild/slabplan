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
 * - Seed users exist: cesar@cadstone.works / Test1!  (admin)
 *                     anwar@cadstone.works / Test2!  (worker)
 *
 * The `setup` project logs both users in once and persists their
 * sessions to tests/e2e/.auth/{cesar,anwar}.json. Specs that need an
 * authenticated starting point read that storageState instead of
 * clicking through the login form — otherwise the auth rate limiter
 * (5/email/10min) would trip before the suite finishes.
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
  ],
})
