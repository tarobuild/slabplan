import { expect, test } from "@playwright/test"
import {
  CESAR,
  PM_EMAIL,
  WORKER_EMAIL,
  authHeaders,
  getPmCredentials,
  loginViaApi,
} from "./helpers/auth"
import {
  createCustomJob,
  deleteJob,
  deleteScheduleItem,
  ensureProjectManagerFixture,
  findUserIdByEmail,
  requireAnyClient,
} from "./helpers/api"
import { PM_STATE } from "./helpers/storage"

/**
 * Golden-path PM-positive coverage (Task #305).
 *
 * Closes the gap left by `golden-path-roles.spec.ts`, which only
 * exercises the negative side of PM gating (worker — also non-admin —
 * gets 403 on admin-only writes). This spec drives the positive side:
 * PM-of-job CAN edit their own job, manage its schedule, and view its
 * financials. Admin still seeds the job (via Cesar) so the suite never
 * silently skips on a clean DB; the PM is the actor for every write
 * under test.
 *
 * The PM identity is provisioned by auth.setup.ts (see PM_STATE +
 * SEED_PM_FIXTURE_PASSWORD). Here we just use the storageState to
 * boot a logged-in PM session and mint a Bearer token via the
 * /auth/refresh path baked into loginViaApi.
 */

test.use({ storageState: PM_STATE })

interface SeededPmJob {
  jobId: string
  adminToken: string
  pmId: string
  workerId: string
  clientId: string
}

async function seedPmJob(
  request: import("@playwright/test").APIRequestContext,
  label: string,
): Promise<SeededPmJob> {
  const adminToken = (await loginViaApi(request, CESAR)).accessToken
  // Same PM helper the role-restricted spec uses — guarantees the PM
  // user exists in the DB even if auth.setup somehow ran against a
  // different DB than this spec.
  await ensureProjectManagerFixture(request, adminToken)
  const pmId = await findUserIdByEmail(request, adminToken, PM_EMAIL)
  if (!pmId) {
    throw new Error(
      `PM fixture (${PM_EMAIL}) is missing. Re-run auth.setup or invite the user manually.`,
    )
  }
  const workerId = await findUserIdByEmail(request, adminToken, WORKER_EMAIL)
  if (!workerId) {
    throw new Error(
      `Worker fixture (${WORKER_EMAIL}) is missing. Re-seed with seed-users.mjs --db=local.`,
    )
  }
  const clientId = await requireAnyClient(request, adminToken)
  const jobId = await createCustomJob(request, adminToken, {
    title: `E2E GP pm-${label} ${Date.now()}`,
    clientId,
    assigneeIds: [workerId],
    projectManagerId: pmId,
  })
  return { jobId, adminToken, pmId, workerId, clientId }
}

test.describe("golden path — PM (project_manager) positive flows", () => {
  let seeded: SeededPmJob
  let scheduleItemId: string | null = null

  test.beforeAll(async ({ request }) => {
    seeded = await seedPmJob(request, "positive")
  })

  test.afterAll(async ({ request }) => {
    if (scheduleItemId) {
      await deleteScheduleItem(request, seeded.adminToken, scheduleItemId)
    }
    if (seeded?.jobId) {
      await deleteJob(request, seeded.adminToken, seeded.jobId)
    }
  })

  test("PM session loads (storageState refreshes into a real PM identity)", async ({
    page,
  }) => {
    await page.goto("/jobs")
    // The PM is the project_manager on the seeded job, so the row must
    // appear on the PM's /jobs list. This also proves the storageState
    // hydrated a logged-in session — an unauthenticated request would
    // bounce to /login instead.
    await page
      .getByPlaceholder(/search/i)
      .first()
      .fill(seeded.jobId.slice(0, 12))
    await expect(
      page.getByText(/E2E GP pm-positive/i).first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  test("PM CAN edit own job, create a schedule item, and read financials", async ({
    request,
  }) => {
    const pmToken = (await loginViaApi(request, getPmCredentials())).accessToken
    const { jobId } = seeded

    // ---- 1. PM edits the title of their own job. The same PUT as
    //         a non-PM, non-admin user returns 403 in
    //         golden-path-roles.spec.ts; this is the positive side.
    const editAsPm = await request.put(`/api/jobs/${jobId}`, {
      headers: {
        ...authHeaders(pmToken),
        "Content-Type": "application/json",
      },
      data: { title: `${jobId.slice(0, 8)} edited by pm` },
    })
    expect(
      editAsPm.ok(),
      `PM job edit failed: ${editAsPm.status()} ${await editAsPm.text()}`,
    ).toBeTruthy()

    // ---- 2. PM creates a schedule item on their own job. Schedule
    //         routes are gated behind assertCanManageJob (admin OR
    //         PM-of-job), so this proves the PM half of that gate.
    const today = new Date()
    const startDate = today.toISOString().slice(0, 10)
    const stamp = Date.now()
    const itemTitle = `PM GP schedule ${stamp}`
    const createSchedule = await request.post(
      `/api/jobs/${jobId}/schedule`,
      {
        headers: {
          ...authHeaders(pmToken),
          "Content-Type": "application/json",
        },
        data: {
          title: itemTitle,
          startDate,
          endDate: startDate,
          itemType: "task",
        },
      },
    )
    expect(
      createSchedule.ok(),
      `PM schedule create failed: ${createSchedule.status()} ${await createSchedule.text()}`,
    ).toBeTruthy()
    const createBody = await createSchedule.json()
    scheduleItemId =
      createBody.item?.id ?? createBody.id ?? null
    expect(scheduleItemId).toBeTruthy()

    // ---- 3. PM reads financials for their own job. GET /financials
    //         calls assertCanAccessJob, which admits the PM-of-job.
    const financials = await request.get(`/api/jobs/${jobId}/financials`, {
      headers: authHeaders(pmToken),
    })
    expect(
      financials.ok(),
      `PM financials read failed: ${financials.status()} ${await financials.text()}`,
    ).toBeTruthy()
  })
})
