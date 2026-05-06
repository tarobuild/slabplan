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
  ensureProjectManagerFixture,
  findUserIdByEmail,
  requireAnyClient,
} from "./helpers/api"
import { gotoViaTopNav, isMobileViewport } from "./helpers/mobile"
import { CESAR_STATE, WORKER_STATE } from "./helpers/storage"

/**
 * Golden-path role coverage (Task #299).
 *
 * Walks the same job lifecycle as `golden-path-admin.spec.ts` from the
 * non-admin perspectives:
 *   - PM: API gating proven via the worker (also non-admin) — admin
 *     edits succeed, non-admin edits and admin-only writes (create
 *     job, mark complete) return 403.
 *   - Crew: drives the UI as the worker fixture. The assigned job
 *     surfaces on /jobs, the schedule sub-page renders read-only,
 *     daily-log creation succeeds via the "Daily Log" dialog, and
 *     admin-only write affordances ("+ New Job", "New Schedule
 *     Item") are not rendered.
 *
 * Setup uses the admin token to seed a job assigned to both the PM
 * fixture and the worker fixture so we never silently skip when the
 * DB is empty. afterAll deletes the seeded job.
 */

interface SeededJob {
  jobId: string
  adminToken: string
  pmId: string
  workerId: string
  clientId: string
}

async function seedRoleJob(
  request: import("@playwright/test").APIRequestContext,
  label: string,
): Promise<SeededJob> {
  const adminToken = (await loginViaApi(request, CESAR)).accessToken
  const pm = await ensureProjectManagerFixture(request, adminToken)
  const workerId = await findUserIdByEmail(request, adminToken, WORKER_EMAIL)
  if (!workerId) {
    throw new Error(
      `Worker fixture (${WORKER_EMAIL}) is missing. Re-seed with seed-users.mjs --db=local.`,
    )
  }
  const clientId = await requireAnyClient(request, adminToken)
  const jobId = await createCustomJob(request, adminToken, {
    title: `E2E GP role-${label} ${Date.now()}`,
    clientId,
    assigneeIds: [workerId],
    projectManagerId: pm.id,
  })
  return { jobId, adminToken, pmId: pm.id, workerId, clientId }
}

test.describe("golden path — PM (project_manager) API gates", () => {
  // No PM session storageState exists yet (filed as follow-up to add
  // one). For now, prove the API gate by exercising it as the worker
  // fixture, which shares the "not admin" gate with PMs on the
  // admin-only endpoints. PM-positive UI flows are tracked separately.
  let seeded: SeededJob

  test.beforeAll(async ({ request }) => {
    seeded = await seedRoleJob(request, "pm")
  })

  test.afterAll(async ({ request }) => {
    if (seeded?.jobId) {
      await deleteJob(request, seeded.adminToken, seeded.jobId)
    }
  })

  test("non-admin cannot create or close a job, but admin paths still succeed", async ({
    request,
  }) => {
    const { jobId, adminToken, clientId } = seeded
    const workerToken = (await loginViaApi(request, getWorkerCredentials()))
      .accessToken

    // POST /api/jobs — admin-only.
    const createDenied = await request.post("/api/jobs", {
      headers: {
        ...authHeaders(workerToken),
        "Content-Type": "application/json",
      },
      data: {
        title: `Should-Fail ${Date.now()}`,
        jobType: "custom",
        contractType: "fixed_price",
        status: "open",
        clientId,
      },
    })
    expect(createDenied.status()).toBe(403)

    // PUT /api/jobs/:id — admin OR PM-of-job. Admin succeeds.
    const editAsAdmin = await request.put(`/api/jobs/${jobId}`, {
      headers: {
        ...authHeaders(adminToken),
        "Content-Type": "application/json",
      },
      data: { title: `${jobId.slice(0, 8)} edited by admin` },
    })
    expect(editAsAdmin.ok()).toBeTruthy()

    // The same PUT as a non-PM, non-admin assignee → 403.
    const editAsWorker = await request.put(`/api/jobs/${jobId}`, {
      headers: {
        ...authHeaders(workerToken),
        "Content-Type": "application/json",
      },
      data: { title: `worker should not edit` },
    })
    expect(editAsWorker.status()).toBe(403)

    // PUT { status: "closed" } — admin-only mark-complete gate.
    const completeDenied = await request.put(`/api/jobs/${jobId}`, {
      headers: {
        ...authHeaders(workerToken),
        "Content-Type": "application/json",
      },
      data: { status: "closed" },
    })
    expect(completeDenied.status()).toBe(403)
  })
})

test.describe("golden path — crew (worker) UI", () => {
  test.use({ storageState: WORKER_STATE })

  let seeded: SeededJob

  test.beforeAll(async ({ request }) => {
    seeded = await seedRoleJob(request, "crew")
  })

  test.afterAll(async ({ request }) => {
    if (seeded?.jobId) {
      await deleteJob(request, seeded.adminToken, seeded.jobId)
    }
  })

  test("crew sees the assigned job, can write a daily log via UI, and admin write affordances are hidden", async ({
    page,
  }) => {
    const { jobId } = seeded

    // ---- 1. Assigned job is visible on the crew /jobs list, and the
    //         "+ New Job" affordance is hidden (admin-only). On
    //         mobile, also confirm the bottom-tab nav (post-#318) is
    //         the entry point and that the admin-only "+ New Job"
    //         remains hidden inside that bottom-nav-driven layout.
    if (isMobileViewport(page)) {
      await page.goto("/dashboard")
      await expect(
        page.getByRole("navigation", { name: /primary mobile/i }),
        "crew on mobile sees the bottom-tab nav",
      ).toBeVisible()
    }
    await gotoViaTopNav(page, "/jobs", /^my jobs$/i)
    await page
      .getByPlaceholder(/search/i)
      .first()
      .fill(seeded.jobId.slice(0, 12))
    // The seeded job's title contains "E2E GP role-crew" — search by
    // that to filter the list down to our row.
    const jobRow = page.getByText(/E2E GP role-crew/i).first()
    await expect(jobRow).toBeVisible({ timeout: 15_000 })

    await expect(
      page.getByRole("button", { name: /\+ ?new job/i }),
      "+ New Job button must be hidden for crew (desktop or mobile)",
    ).toHaveCount(0)

    // ---- 2. Schedule sub-page renders for the crew member, but the
    //         "New Schedule Item" write affordance is hidden.
    await page.goto(`/jobs/${jobId}/schedule`)
    await page.getByRole("button", { name: /^list$/i }).first().click()
    await expect(
      page.getByRole("button", { name: /^new schedule item$/i }),
      "New Schedule Item button must be hidden for crew",
    ).toHaveCount(0)
    // Crew also cannot see the admin-only "Job actions" menu trigger.
    await expect(
      page.getByRole("button", { name: /job actions/i }),
      "Job actions menu must be hidden for crew",
    ).toHaveCount(0)

    // ---- 3. Crew CAN create a daily log on an assigned job via UI.
    await page.goto(`/jobs/${jobId}/daily-logs`)
    await page
      .getByRole("button", { name: /^daily log$/i })
      .first()
      .click()
    const logDialog = page.getByRole("dialog").last()
    await expect(logDialog).toBeVisible({ timeout: 10_000 })

    const stamp = Date.now()
    const title = `Crew GP log ${stamp}`
    const notes = `Crew golden-path notes ${stamp}`
    await logDialog
      .getByPlaceholder(/kitchen counter install/i)
      .fill(title)
    await logDialog
      .getByPlaceholder(/describe what happened on site today/i)
      .fill(notes)

    const logCreatePromise = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/jobs\/[^/]+\/daily-logs$/.test(res.url()),
      { timeout: 20_000 },
    )
    await logDialog.getByRole("button", { name: /^publish$/i }).click()
    const logResp = await logCreatePromise
    expect(
      logResp.ok(),
      `crew daily-log create failed: ${logResp.status()} ${await logResp.text()}`,
    ).toBeTruthy()

    // Cross-screen freshness: the log appears on the feed for crew.
    await expect(page.getByText(notes).first()).toBeVisible({
      timeout: 15_000,
    })
    // Cleanup of the log itself cascades when the parent job is
    // deleted in afterAll.
  })
})
