import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;

let adminToken: string;
let pmToken: string;
let crewToken: string;

const adminUserId = crypto.randomUUID();
const pmUserId = crypto.randomUUID();
const crewUserId = crypto.randomUUID();

const jobId = crypto.randomUUID();
const folderId = crypto.randomUUID();
const fileId = crypto.randomUUID();
const otherFileId = crypto.randomUUID();

// One annotation is created during setup so the routing/authorization tests
// have something stable to target. Per-test annotations are created on demand
// for assertions that need a fresh row.
const seededAnnotationId = crypto.randomUUID();

const createdAnnotationIds: string[] = [seededAnnotationId];

function makePublicUser(id: string, role: string, email: string, fullName: string) {
  return {
    id,
    email,
    fullName,
    role,
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function authedFetch(
  path: string,
  init: { method?: string; token: string; body?: unknown } = { token: "" },
) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${init.token}`,
  };
  const method = init.method ?? "GET";
  const body =
    init.body !== undefined ? JSON.stringify(init.body) : undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    headers["x-requested-with"] = "XMLHttpRequest";
  }
  return fetch(`${baseUrl}${path}`, { method, headers, body });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  // The shared db client (lib/db) prefers SUPABASE_DATABASE_URL when set, but
  // that points at the production pooler with a 15-client cap that the test
  // suites blow through immediately. Force tests to use the local DATABASE_URL.
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const {
    users,
    jobs,
    jobAssignees,
    folders,
    files,
    fileAnnotations,
  } = await import("@workspace/db/schema");

  await prepareApp();

  const passwordHash = "test-not-a-real-hash";
  const adminEmail = `admin-${adminUserId}@anno-test.local`;
  const pmEmail = `pm-${pmUserId}@anno-test.local`;
  const crewEmail = `crew-${crewUserId}@anno-test.local`;

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash,
      fullName: "ZZZ Annotation Admin",
      role: "admin",
    },
    {
      id: pmUserId,
      email: pmEmail,
      passwordHash,
      fullName: "ZZZ Annotation PM",
      role: "project_manager",
    },
    {
      id: crewUserId,
      email: crewEmail,
      passwordHash,
      fullName: "ZZZ Annotation Crew",
      role: "crew_member",
    },
  ]);

  await db.insert(jobs).values({
    id: jobId,
    title: "ZZZ Annotation Test Job",
    createdBy: pmUserId,
    projectManagerId: pmUserId,
  });

  // Crew is a job assignee so they can VIEW the file but they are not the
  // creator of the annotation, so they must still be denied a PATCH.
  await db.insert(jobAssignees).values({
    jobId,
    userId: crewUserId,
  });

  await db.insert(folders).values({
    id: folderId,
    title: "ZZZ Annotation Test Folder",
    scope: "job",
    jobId,
    mediaType: "documents",
  });

  await db.insert(files).values([
    {
      id: fileId,
      folderId,
      filename: "plan.pdf",
      originalName: "plan.pdf",
      mimeType: "application/pdf",
      uploadedBy: pmUserId,
    },
    {
      id: otherFileId,
      folderId,
      filename: "other.pdf",
      originalName: "other.pdf",
      mimeType: "application/pdf",
      uploadedBy: pmUserId,
    },
  ]);

  await db.insert(fileAnnotations).values({
    id: seededAnnotationId,
    fileId,
    page: 1,
    toolType: "rectangle",
    color: "#facc15",
    thickness: "2",
    opacity: "1",
    normalizedX: "0.10000000",
    normalizedY: "0.20000000",
    normalizedW: "0.30000000",
    normalizedH: "0.40000000",
    content: null,
    pathData: null,
    createdBy: pmUserId,
  });

  adminToken = auth.signAccessToken(
    makePublicUser(adminUserId, "admin", adminEmail, "ZZZ Annotation Admin"),
  );
  pmToken = auth.signAccessToken(
    makePublicUser(pmUserId, "project_manager", pmEmail, "ZZZ Annotation PM"),
  );
  crewToken = auth.signAccessToken(
    makePublicUser(crewUserId, "crew_member", crewEmail, "ZZZ Annotation Crew"),
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const {
    activityLog,
    fileAnnotations,
    files,
    folders,
    jobAssignees,
    jobs,
    users,
  } = await import("@workspace/db/schema");
  const { inArray, eq } = await import("drizzle-orm");

  try {
    // Activity log rows reference the annotation entity ids — clean those up
    // before the annotation rows so foreign-key-less metadata queries stay
    // self-consistent.
    if (createdAnnotationIds.length > 0) {
      await db
        .delete(activityLog)
        .where(inArray(activityLog.entityId, createdAnnotationIds));
      await db
        .delete(fileAnnotations)
        .where(inArray(fileAnnotations.id, createdAnnotationIds));
    }
    await db.delete(files).where(inArray(files.id, [fileId, otherFileId]));
    await db.delete(folders).where(eq(folders.id, folderId));
    await db.delete(jobAssignees).where(eq(jobAssignees.jobId, jobId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db
      .delete(users)
      .where(inArray(users.id, [adminUserId, pmUserId, crewUserId]));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await pool.end();
  }
});

async function seedAnnotation(overrides: Record<string, unknown> = {}) {
  const { db } = await import("@workspace/db");
  const { fileAnnotations } = await import("@workspace/db/schema");
  const id = crypto.randomUUID();
  createdAnnotationIds.push(id);
  await db.insert(fileAnnotations).values({
    id,
    fileId,
    page: 1,
    toolType: "rectangle",
    color: "#facc15",
    thickness: "2",
    opacity: "1",
    normalizedX: "0.10000000",
    normalizedY: "0.20000000",
    normalizedW: "0.30000000",
    normalizedH: "0.40000000",
    content: null,
    pathData: null,
    createdBy: pmUserId,
    ...overrides,
  });
  return id;
}

test("PATCH /files/:id/annotations/:annoId updates fields when called by the creator", async () => {
  const annoId = await seedAnnotation();

  const response = await authedFetch(
    `/api/files/${fileId}/annotations/${annoId}`,
    {
      method: "PATCH",
      token: pmToken,
      body: {
        color: "#00ff00",
        thickness: 6,
        opacity: 0.5,
        normalizedX: 0.42,
        content: "updated note",
      },
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    annotation: {
      id: string;
      color: string;
      thickness: number;
      opacity: number;
      normalizedX: number;
      content: string | null;
    };
  };

  assert.equal(body.annotation.id, annoId);
  assert.equal(body.annotation.color, "#00ff00");
  assert.equal(body.annotation.thickness, 6);
  assert.equal(body.annotation.opacity, 0.5);
  assert.equal(body.annotation.normalizedX, 0.42);
  assert.equal(body.annotation.content, "updated note");

  // Confirm the row was actually persisted, not just echoed back.
  const { db } = await import("@workspace/db");
  const { fileAnnotations } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select()
    .from(fileAnnotations)
    .where(eq(fileAnnotations.id, annoId))
    .limit(1);
  assert.ok(row, "annotation row should exist after PATCH");
  assert.equal(row!.color, "#00ff00");
  assert.equal(row!.content, "updated note");
});

test("PATCH /files/:id/annotations/:annoId returns 403 when called by a non-creator non-admin", async () => {
  const annoId = await seedAnnotation();

  const response = await authedFetch(
    `/api/files/${fileId}/annotations/${annoId}`,
    {
      method: "PATCH",
      token: crewToken,
      body: { color: "#ff00ff" },
    },
  );

  assert.equal(response.status, 403);

  // Confirm no fields were modified.
  const { db } = await import("@workspace/db");
  const { fileAnnotations } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select()
    .from(fileAnnotations)
    .where(eq(fileAnnotations.id, annoId))
    .limit(1);
  assert.equal(row!.color, "#facc15");
});

test("PATCH /files/:id/annotations/:annoId still allows admins (non-creator) to edit", async () => {
  // Sanity check that the 403 above is specifically about the
  // non-creator-non-admin combination — admins must still be allowed even
  // when they did not create the annotation.
  const annoId = await seedAnnotation();

  const response = await authedFetch(
    `/api/files/${fileId}/annotations/${annoId}`,
    {
      method: "PATCH",
      token: adminToken,
      body: { color: "#abcdef" },
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { annotation: { color: string } };
  assert.equal(body.annotation.color, "#abcdef");
});

test("PATCH /files/:id/annotations/:annoId returns 404 when the URL fileId does not match the annotation", async () => {
  const annoId = await seedAnnotation();

  // Annotation belongs to `fileId`, but we request it under `otherFileId`.
  // The route must reject this with 404 to prevent cross-file annotation
  // updates that would otherwise share authorization bounds.
  const response = await authedFetch(
    `/api/files/${otherFileId}/annotations/${annoId}`,
    {
      method: "PATCH",
      token: pmToken,
      body: { color: "#deadbe" },
    },
  );

  assert.equal(response.status, 404);

  // Annotation should not have been mutated.
  const { db } = await import("@workspace/db");
  const { fileAnnotations } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select()
    .from(fileAnnotations)
    .where(eq(fileAnnotations.id, annoId))
    .limit(1);
  assert.equal(row!.color, "#facc15");
});

test("PATCH writes an 'edited' activity row whose metadata.changed lists every modified field", async () => {
  const annoId = await seedAnnotation();

  const response = await authedFetch(
    `/api/files/${fileId}/annotations/${annoId}`,
    {
      method: "PATCH",
      token: pmToken,
      body: {
        color: "#112233",
        thickness: 4,
        opacity: 0.25,
        normalizedX: 0.55,
        normalizedY: 0.66,
        normalizedW: 0.21,
        normalizedH: 0.22,
        content: "audited edit",
      },
    },
  );
  assert.equal(response.status, 200);

  const { db } = await import("@workspace/db");
  const { activityLog } = await import("@workspace/db/schema");
  const { and, eq, desc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, "file_annotation"),
        eq(activityLog.entityId, annoId),
        eq(activityLog.action, "edited"),
      ),
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(1);

  assert.equal(rows.length, 1, "exactly one 'edited' activity row should exist");
  const row = rows[0];
  assert.equal(row.userId, pmUserId);
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  assert.equal(metadata.fileId, fileId);
  assert.equal(metadata.jobId, jobId);
  assert.equal(metadata.toolType, "rectangle");
  assert.equal(metadata.page, 1);

  const changed = metadata.changed as string[] | undefined;
  assert.ok(
    Array.isArray(changed),
    "metadata.changed must be an array of field names",
  );
  // The route collapses normalizedX/Y → "position" and normalizedW/H → "size"
  // so the human-readable list shows one entry per logical change rather than
  // four near-duplicates.
  const changedSet = new Set(changed);
  for (const expected of [
    "color",
    "thickness",
    "opacity",
    "position",
    "size",
    "content",
  ]) {
    assert.ok(
      changedSet.has(expected),
      `metadata.changed should include '${expected}', got: ${JSON.stringify(changed)}`,
    );
  }
  // Position/size must not be duplicated even though both X+Y / W+H changed.
  const occurrences = (val: string) =>
    changed!.filter((c) => c === val).length;
  assert.equal(occurrences("position"), 1);
  assert.equal(occurrences("size"), 1);
});

test("PATCH 'edited' activity row only includes fields that actually changed", async () => {
  // If the caller submits a value identical to the current one, that field
  // must be omitted from `changed[]` — the activity feed should not falsely
  // report edits that didn't happen.
  const annoId = await seedAnnotation({ color: "#abcabc" });

  const response = await authedFetch(
    `/api/files/${fileId}/annotations/${annoId}`,
    {
      method: "PATCH",
      token: pmToken,
      body: {
        color: "#abcabc", // unchanged — must be skipped
        thickness: 9, // changed
      },
    },
  );
  assert.equal(response.status, 200);

  const { db } = await import("@workspace/db");
  const { activityLog } = await import("@workspace/db/schema");
  const { and, eq, desc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, "file_annotation"),
        eq(activityLog.entityId, annoId),
        eq(activityLog.action, "edited"),
      ),
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(1);

  assert.equal(rows.length, 1);
  const metadata = (rows[0].metadata ?? {}) as Record<string, unknown>;
  const changed = metadata.changed as string[];
  assert.deepEqual(changed, ["thickness"]);
});
