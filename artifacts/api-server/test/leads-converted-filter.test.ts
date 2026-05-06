// Regression coverage for Task #330 (the violet "Converted" badge and the
// "Converted" entry in the Leads status filter).
//
// The cadstone Leads page sends:
//   * `?onlyConverted=true` when the user picks "Converted" from the
//     status dropdown, and
//   * `?excludeConverted=true` (the default) so converted leads are
//     hidden until the "Show converted" toggle is flipped on.
//
// Both paths look up converted leads via the activity_log row that
// `POST /leads/:id/convert-to-job` writes (entityType="lead",
// action="converted_to_job", metadata.convertedJobId -> jobs.id).
//
// This test seeds two leads — one converted via the activity_log fixture
// path, one plain "won" — and asserts each filter returns only the
// expected lead. If listConvertedLeadIds or the onlyConverted /
// excludeConverted branches in routes/leads.ts regress, this fails
// before the UI does.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let adminToken: string;

const adminUserId = crypto.randomUUID();
const clientId = crypto.randomUUID();
const convertedLeadId = crypto.randomUUID();
const plainWonLeadId = crypto.randomUUID();
const linkedJobId = crypto.randomUUID();

const adminEmail = `admin-${adminUserId}@leads-converted-filter-test.local`;
// Per-run discriminator embedded in seeded titles so we can scope the
// list query to ONLY this suite's rows via `?search=` — sibling suites
// (and prior partial runs) leave behind leads in the shared test DB.
const marker = `zzz-converted-filter-${crypto.randomUUID()}`;

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  // The shared db client prefers SUPABASE_DATABASE_URL, but that points
  // at the prod pooler. Tests must hit the local DB.
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const { users, clients, jobs, leads, activityLog } = await import(
    "@workspace/db/schema"
  );

  await prepareApp();

  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Converted Filter Admin",
    role: "admin",
  });

  await db.insert(clients).values({
    id: clientId,
    companyName: `ZZZ Converted Filter Client ${clientId}`,
    createdBy: adminUserId,
  });

  // The "converted" lead — DB status is `won` (mirroring what
  // /convert-to-job sets) and there is a live converted_to_job
  // activity_log row pointing at a non-deleted job. This is the exact
  // shape listConvertedLeadIds joins on.
  await db.insert(leads).values([
    {
      id: convertedLeadId,
      title: `Converted Filter Lead CONVERTED ${marker}`,
      status: "won",
      createdBy: adminUserId,
    },
    {
      // The "plain won" lead — same DB status, but NO converted_to_job
      // activity. listConvertedLeadIds must NOT pick this up; the UI
      // status filter "Converted" hinges entirely on the activity_log
      // row, not on `lead.status`.
      id: plainWonLeadId,
      title: `Converted Filter Lead PLAIN-WON ${marker}`,
      status: "won",
      createdBy: adminUserId,
    },
  ]);

  await db.insert(jobs).values({
    id: linkedJobId,
    title: `Converted Filter Job ${marker}`,
    clientId,
    createdBy: adminUserId,
    projectManagerId: adminUserId,
  });

  await db.insert(activityLog).values({
    entityType: "lead",
    entityId: convertedLeadId,
    action: "converted_to_job",
    userId: adminUserId,
    metadata: { convertedJobId: linkedJobId },
  });

  adminToken = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Converted Filter Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { users, clients, jobs, leads, activityLog } = await import(
    "@workspace/db/schema"
  );
  const { eq, inArray } = await import("drizzle-orm");
  try {
    await db
      .delete(activityLog)
      .where(inArray(activityLog.entityId, [convertedLeadId, plainWonLeadId]));
    await db
      .delete(leads)
      .where(inArray(leads.id, [convertedLeadId, plainWonLeadId]));
    await db.delete(jobs).where(eq(jobs.id, linkedJobId));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(users).where(eq(users.id, adminUserId));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await pool.end();
  }
});

type LeadRow = {
  id: string;
  title: string;
  status: string;
  convertedJob: { id: string; title: string; status: string } | null;
};
type LeadListResponse = { leads: LeadRow[] };

async function listLeads(params: string): Promise<LeadRow[]> {
  // Scope the list to this suite's rows via the shared `marker` — the
  // test DB carries leftovers from sibling suites that would otherwise
  // also match the converted/won filters.
  const url =
    `${baseUrl}/api/leads?pageSize=100` +
    `&search=${encodeURIComponent(marker)}` +
    (params ? `&${params}` : "");
  const res = await fetch(url, { headers: authHeaders(adminToken) });
  assert.equal(res.status, 200, `GET ${url} -> ${res.status}`);
  const body = (await res.json()) as LeadListResponse;
  assert.ok(Array.isArray(body.leads));
  return body.leads;
}

test("GET /leads?onlyConverted=true returns ONLY the lead with a live converted_to_job activity", async () => {
  const rows = await listLeads("onlyConverted=true");
  const ids = rows.map((r) => r.id).sort();
  assert.deepEqual(
    ids,
    [convertedLeadId].sort(),
    `onlyConverted=true must surface the converted lead and hide the plain-won lead. Got: ${JSON.stringify(rows.map((r) => ({ id: r.id, title: r.title })))}`,
  );
  // The hydrated convertedJob ref is what drives the violet "Converted"
  // badge in the UI (getDisplayStatus in pages/leads.tsx flips the label
  // whenever convertedJob is non-null). Pin it here so a regression in
  // lookupConvertedJobsByLeadIds also fails this test.
  assert.ok(
    rows[0]?.convertedJob && rows[0].convertedJob.id === linkedJobId,
    "converted lead row must hydrate convertedJob.id pointing at the linked job",
  );
});

test("GET /leads?excludeConverted=true returns ONLY the plain-won lead", async () => {
  const rows = await listLeads("excludeConverted=true");
  const ids = rows.map((r) => r.id).sort();
  assert.deepEqual(
    ids,
    [plainWonLeadId].sort(),
    `excludeConverted=true must hide the converted lead and surface the plain-won lead. Got: ${JSON.stringify(rows.map((r) => ({ id: r.id, title: r.title })))}`,
  );
  assert.equal(
    rows[0]?.convertedJob ?? null,
    null,
    "plain-won lead must not hydrate a convertedJob ref",
  );
});

test("GET /leads (no converted filter) returns BOTH leads — sanity check on the seed", async () => {
  const rows = await listLeads("");
  const ids = new Set(rows.map((r) => r.id));
  assert.ok(
    ids.has(convertedLeadId) && ids.has(plainWonLeadId),
    `unfiltered list must include both seeded leads. Got: ${JSON.stringify([...ids])}`,
  );
});
