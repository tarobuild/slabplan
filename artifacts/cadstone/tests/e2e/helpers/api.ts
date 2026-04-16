import type { APIRequestContext } from "@playwright/test"
import { authHeaders } from "./auth"

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
