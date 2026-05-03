import type { APIRequestContext } from "@playwright/test"
import { authHeaders } from "./auth"

const RESEED_HINT =
  "Re-seed the local DB with " +
  "`SEED_ADMIN_*_PASSWORD=... SEED_WORKER_FIXTURE_PASSWORD=... " +
  "node artifacts/api-server/scripts/seed-users.mjs --db=local` " +
  "(it now also creates a baseline E2E fixture client + open job)."

/** Pick any open job the logged-in user can see, or null if none. */
export async function pickAnyJob(
  request: APIRequestContext,
  token: string,
): Promise<{ id: string; title: string } | null> {
  const res = await request.get("/api/jobs?page=1&pageSize=1", {
    headers: authHeaders(token),
  })
  if (!res.ok()) return null
  const body = await res.json()
  const first = body.jobs?.[0]
  return first ? { id: first.id, title: first.title } : null
}

/** Fetch any existing client id we can attach a new job to. */
export async function pickAnyClient(
  request: APIRequestContext,
  token: string,
): Promise<string | null> {
  const res = await request.get("/api/clients?page=1&pageSize=1", {
    headers: authHeaders(token),
  })
  if (!res.ok()) return null
  const body = await res.json()
  return body.clients?.[0]?.id ?? null
}

/**
 * Like `pickAnyJob`, but throws a loud, actionable error instead of
 * returning null. Specs use this in beforeAll so that a missing seed
 * fixture surfaces as a hard failure rather than a silent test.skip
 * (the prior pattern that hid 12 of 17 specs on a clean local DB).
 */
export async function requireAnyJob(
  request: APIRequestContext,
  token: string,
): Promise<{ id: string; title: string }> {
  const job = await pickAnyJob(request, token)
  if (!job) {
    throw new Error(`No open job found via /api/jobs. ${RESEED_HINT}`)
  }
  return job
}

/**
 * Like `pickAnyClient`, but throws a loud, actionable error instead of
 * returning null. See `requireAnyJob` for the rationale.
 */
export async function requireAnyClient(
  request: APIRequestContext,
  token: string,
): Promise<string> {
  const clientId = await pickAnyClient(request, token)
  if (!clientId) {
    throw new Error(`No client found via /api/clients. ${RESEED_HINT}`)
  }
  return clientId
}

/** Create a throwaway custom job. Returns the created job's id. */
export async function createTestJob(
  request: APIRequestContext,
  token: string,
  opts: { title: string; clientId: string },
): Promise<string> {
  const res = await request.post("/api/jobs", {
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    data: {
      title: opts.title,
      jobType: "custom",
      contractType: "fixed_price",
      status: "open",
      clientId: opts.clientId,
    },
  })
  if (!res.ok()) {
    throw new Error(`createTestJob failed: ${res.status()} ${await res.text()}`)
  }
  const body = await res.json()
  return body.job?.id ?? body.id
}

/** Best-effort delete of a job by id; swallow 404s so cleanup is idempotent. */
export async function deleteJob(
  request: APIRequestContext,
  token: string,
  jobId: string,
): Promise<void> {
  await request.delete(`/api/jobs/${jobId}`, { headers: authHeaders(token) })
}

/**
 * Create a custom job with optional assignees and projected dates. Used by
 * specs that need to seed a job in a specific shape (e.g. the worker
 * read-only test, which needs to be assigned to the job to see it).
 */
export async function createCustomJob(
  request: APIRequestContext,
  token: string,
  opts: {
    title: string
    clientId: string
    assigneeIds?: string[]
    projectedStart?: string | null
    projectedCompletion?: string | null
    projectManagerId?: string | null
  },
): Promise<string> {
  const res = await request.post("/api/jobs", {
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    data: {
      title: opts.title,
      jobType: "custom",
      contractType: "fixed_price",
      status: "open",
      clientId: opts.clientId,
      assigneeIds: opts.assigneeIds ?? [],
      projectedStart: opts.projectedStart ?? null,
      projectedCompletion: opts.projectedCompletion ?? null,
      projectManagerId: opts.projectManagerId ?? null,
    },
  })
  if (!res.ok()) {
    throw new Error(`createCustomJob failed: ${res.status()} ${await res.text()}`)
  }
  const body = await res.json()
  return body.job?.id ?? body.id
}

export interface JobDetail {
  id: string
  projectManagerId: string | null
  projectedStart: string | null
  projectedCompletion: string | null
  status: string
  title: string
}

/** Fetch the full job record, used by inline-edit specs to assert persistence. */
export async function fetchJobDetail(
  request: APIRequestContext,
  token: string,
  jobId: string,
): Promise<JobDetail> {
  const res = await request.get(`/api/jobs/${jobId}`, {
    headers: authHeaders(token),
  })
  if (!res.ok()) {
    throw new Error(`fetchJobDetail failed: ${res.status()} ${await res.text()}`)
  }
  const body = await res.json()
  return body.job
}

/** Resolve a user's id by email. Caller must hold a manager+ token. */
export async function findUserIdByEmail(
  request: APIRequestContext,
  token: string,
  email: string,
): Promise<string | null> {
  const res = await request.get("/api/users?limit=200", {
    headers: authHeaders(token),
  })
  if (!res.ok()) {
    throw new Error(`findUserIdByEmail failed: ${res.status()} ${await res.text()}`)
  }
  const body = await res.json()
  const match = (body.users ?? []).find(
    (u: { email: string; id: string }) => u.email.toLowerCase() === email.toLowerCase(),
  )
  return match?.id ?? null
}

/**
 * Ensure the synthetic fixture PM (`fixture-pm@cadstone.test`) exists
 * in the local DB so:
 *   1. The inline PM picker on /jobs has a real option to choose.
 *   2. `auth.setup.ts` can deterministically reissue an invite token
 *      for THAT specific user and consume it via /auth/accept-invite
 *      to provision the PM session.
 *
 * Idempotent: if the fixture user already exists (active), reuses it.
 * Otherwise invites it. Crucially, the lookup keys on email — not
 * "any active project_manager" — so an environment that already has
 * other PMs still ends up with `fixture-pm@cadstone.test` provisioned.
 * That keeps the e2e suite working on non-clean DBs (e.g. a developer
 * box where someone manually invited a real PM).
 */
export async function ensureProjectManagerFixture(
  request: APIRequestContext,
  token: string,
): Promise<{ id: string; fullName: string }> {
  const fixtureEmail = "fixture-pm@cadstone.test"
  const res = await request.get("/api/users?roles=project_manager&limit=200", {
    headers: authHeaders(token),
  })
  if (!res.ok()) {
    throw new Error(
      `ensureProjectManagerFixture list failed: ${res.status()} ${await res.text()}`,
    )
  }
  const body = await res.json()
  const existing = (body.users ?? []).find(
    (u: { email: string; isActive?: boolean | null }) =>
      u.email.toLowerCase() === fixtureEmail && u.isActive !== false,
  )
  if (existing) {
    return { id: existing.id, fullName: existing.fullName }
  }

  const fullName = "E2E Fixture Project Manager"
  const invite = await request.post("/api/users", {
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    data: {
      email: fixtureEmail,
      fullName,
      role: "project_manager",
    },
  })
  if (!invite.ok()) {
    throw new Error(
      `ensureProjectManagerFixture invite failed: ${invite.status()} ${await invite.text()}`,
    )
  }
  const inviteBody = await invite.json()
  return { id: inviteBody.user.id, fullName: inviteBody.user.fullName }
}

/**
 * Reissue an invite token for an existing user, returning the raw token
 * string (the API returns it exactly once in the response and never
 * persists it server-side). Used by auth.setup.ts to mint a fresh
 * invite for the PM fixture so it can be consumed by /auth/accept-invite
 * to (re)set the PM's password to a known value.
 */
export async function reissueInvite(
  request: APIRequestContext,
  adminToken: string,
  userId: string,
): Promise<{ token: string }> {
  const res = await request.post(`/api/users/${userId}/invite`, {
    headers: authHeaders(adminToken),
  })
  if (!res.ok()) {
    throw new Error(
      `reissueInvite failed for ${userId}: ${res.status()} ${await res.text()}`,
    )
  }
  const body = await res.json()
  if (typeof body.inviteToken !== "string") {
    throw new Error(
      `reissueInvite: unexpected response shape, missing inviteToken: ${JSON.stringify(body)}`,
    )
  }
  return { token: body.inviteToken }
}

/** Mark a schedule item as deleted via the REST API, best-effort. */
export async function deleteScheduleItem(
  request: APIRequestContext,
  token: string,
  itemId: string,
): Promise<void> {
  await request.delete(`/api/schedule-items/${itemId}`, {
    headers: authHeaders(token),
  })
}
