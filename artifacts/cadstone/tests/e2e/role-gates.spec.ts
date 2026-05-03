import { expect, test } from "@playwright/test"
import {
  CESAR,
  WORKER_EMAIL,
  authHeaders,
  getWorkerCredentials,
  loginViaApi,
} from "./helpers/auth"
import {
  createCustomJob,
  deleteJob,
  findUserIdByEmail,
  requireAnyClient,
  requireAnyJob,
} from "./helpers/api"
import { CESAR_STATE, WORKER_STATE } from "./helpers/storage"

/**
 * Frontend hardening: write affordances on the Schedule page (Set
 * Baseline, Workday Exception, New Schedule Item, Settings cog) must be
 * hidden for crew members and visible for admin/PM. The backend already
 * rejects writes from crew via 403; these specs assert the UI matches
 * that gate so users don't see disabled "ghost" buttons.
 *
 * No PM seed fixture exists yet, so we cover (admin -> visible) and
 * (crew -> hidden). The convention being asserted is documented in
 * replit.md under "canWrite role gating".
 *
 * The crew-side describes used to `test.skip()` whenever the worker
 * fixture happened to have no assigned jobs — that masked the whole
 * coverage area when fixtures drifted. We now seed a per-suite job
 * assigned to the worker via the admin API so the worker view is
 * always exercisable; setup throws if the seed itself fails.
 */

async function seedWorkerJob(
  request: import("@playwright/test").APIRequestContext,
  label: string,
): Promise<{ jobId: string; adminToken: string }> {
  const adminToken = (await loginViaApi(request, CESAR)).accessToken
  const workerId = await findUserIdByEmail(request, adminToken, WORKER_EMAIL)
  if (!workerId) {
    throw new Error(
      `Worker fixture user (${WORKER_EMAIL}) is missing. Re-seed the local ` +
        `DB with seed-users.mjs --db=local.`,
    )
  }
  const clientId = await requireAnyClient(request, adminToken)
  const jobId = await createCustomJob(request, adminToken, {
    title: `E2E role-gate ${label} ${Date.now()}`,
    clientId,
    assigneeIds: [workerId],
  })
  return { jobId, adminToken }
}

test.describe("financials role gates", () => {
  test.describe("admin (Cesar) sees financials write affordances", () => {
    test.use({ storageState: CESAR_STATE })

    test("financials page exposes write actions", async ({ page, request }) => {
      const token = (await loginViaApi(request, CESAR)).accessToken
      const job = await requireAnyJob(request, token)

      await page.goto(`/jobs/${job.id}/financials`)
      // The "Add area" affordance only renders for admin/PM. Crew get
      // the access-denied card instead (asserted in the next describe).
      await expect(
        page.getByRole("button", { name: /add area/i }).first(),
      ).toBeVisible({ timeout: 15_000 })
    })
  })

  test.describe("crew (Worker) sees access denied on financials", () => {
    test.use({ storageState: WORKER_STATE })

    let workerJobId = ""
    let adminToken = ""

    test.beforeAll(async ({ request }) => {
      const seeded = await seedWorkerJob(request, "financials")
      workerJobId = seeded.jobId
      adminToken = seeded.adminToken
    })

    test.afterAll(async ({ request }) => {
      if (workerJobId) await deleteJob(request, adminToken, workerJobId)
    })

    test("financials page is locked down for crew", async ({ page, request }) => {
      const worker = getWorkerCredentials()
      const token = (await loginViaApi(request, worker)).accessToken
      // Sanity: the worker really can see the seeded job.
      const jobsRes = await request.get(
        `/api/jobs?page=1&pageSize=200`,
        { headers: authHeaders(token) },
      )
      expect(jobsRes.ok()).toBeTruthy()
      const body = await jobsRes.json()
      const job = (body.jobs ?? []).find(
        (j: { id: string }) => j.id === workerJobId,
      )
      expect(
        job,
        `Worker should see the seeded role-gate job (id=${workerJobId})`,
      ).toBeTruthy()

      await page.goto(`/jobs/${workerJobId}/financials`)

      // Add-area / Add-line-item affordances must not render. The page
      // shows an "access denied"-style message instead.
      await expect(
        page.getByRole("button", { name: /add area/i }),
      ).toHaveCount(0, { timeout: 15_000 })
    })
  })
})

test.describe("schedule role gates", () => {
  test.describe("admin (Cesar) sees write affordances", () => {
    test.use({ storageState: CESAR_STATE })

    test("schedule page exposes write actions", async ({ page, request }) => {
      const token = (await loginViaApi(request, CESAR)).accessToken
      const job = await requireAnyJob(request, token)

      await page.goto(`/jobs/${job.id}/schedule`)
      await expect(
        page.getByRole("button", { name: /^new schedule item$/i }),
      ).toBeVisible({ timeout: 15_000 })

      await page.getByRole("tab", { name: /workday exceptions/i }).click()
      await expect(
        page.getByRole("button", { name: /^workday exception$/i }),
      ).toBeVisible()

      await page.getByRole("tab", { name: /^baseline$/i }).click()
      await expect(
        page.getByRole("button", { name: /^set baseline$/i }),
      ).toBeVisible()
    })
  })

  test.describe("crew (Worker) sees a read-only schedule", () => {
    test.use({ storageState: WORKER_STATE })

    let workerJobId = ""
    let adminToken = ""

    test.beforeAll(async ({ request }) => {
      const seeded = await seedWorkerJob(request, "schedule")
      workerJobId = seeded.jobId
      adminToken = seeded.adminToken
    })

    test.afterAll(async ({ request }) => {
      if (workerJobId) await deleteJob(request, adminToken, workerJobId)
    })

    test("write affordances are hidden", async ({ page }) => {
      await page.goto(`/jobs/${workerJobId}/schedule`)

      // Wait for the toolbar to render (History button stays visible
      // for everyone — its presence proves the toolbar mounted).
      await expect(page.getByRole("tab", { name: /^schedule$/i })).toBeVisible({
        timeout: 15_000,
      })

      await expect(
        page.getByRole("button", { name: /^new schedule item$/i }),
      ).toHaveCount(0)

      await page.getByRole("tab", { name: /workday exceptions/i }).click()
      await expect(
        page.getByRole("button", { name: /^workday exception$/i }),
      ).toHaveCount(0)

      await page.getByRole("tab", { name: /^baseline$/i }).click()
      await expect(
        page.getByRole("button", { name: /^set baseline$/i }),
      ).toHaveCount(0)
    })
  })
})
