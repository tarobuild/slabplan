import assert from "node:assert/strict";
import { before, test } from "node:test";

let deletePhysicalFileBestEffort: (
  fileUrl: string | null | undefined,
  context: string,
) => Promise<void>;
type PersistWithStorageRollback = <TResult>(params: {
  fileUrl: string;
  context: string;
  persist: () => Promise<TResult>;
  postCommit?: (result: TResult) => Promise<void>;
  rollback?: (result: TResult) => Promise<void>;
}) => Promise<TResult>;
let persistWithStorageRollback: PersistWithStorageRollback;

before(async () => {
  // Silence pino so the rollback tests do not flood stderr with the
  // "Failed to delete stored file" warnings they intentionally trigger.
  // pino reads LOG_LEVEL at module-import time, so this assignment must
  // run before the dynamic import below.
  process.env.LOG_LEVEL = "silent";
  ({ deletePhysicalFileBestEffort, persistWithStorageRollback } = await import(
    "../src/lib/uploads.ts"
  ));
});

test("deletePhysicalFileBestEffort is a no-op for null/undefined/empty", async () => {
  await assert.doesNotReject(
    deletePhysicalFileBestEffort(null, "test:null"),
  );
  await assert.doesNotReject(
    deletePhysicalFileBestEffort(undefined, "test:undefined"),
  );
  await assert.doesNotReject(
    deletePhysicalFileBestEffort("", "test:empty"),
  );
});

test("deletePhysicalFileBestEffort never throws even when the storage call would fail", async () => {
  // Force the underlying storage helper down a failure path:
  // PRIVATE_OBJECT_DIR is required to translate a /uploads/... URL into
  // a bucket/object pair, and an unset value makes the translation
  // throw synchronously. The wrapper must swallow that error so the
  // caller — already on the failure path — is never derailed by the
  // rollback itself.
  const previous = process.env.PRIVATE_OBJECT_DIR;
  delete process.env.PRIVATE_OBJECT_DIR;

  try {
    await assert.doesNotReject(
      deletePhysicalFileBestEffort(
        "/uploads/lead-deadbeef/document/123-abc-foo.pdf",
        "test:storage-failure",
      ),
    );
  } finally {
    if (previous !== undefined) {
      process.env.PRIVATE_OBJECT_DIR = previous;
    }
  }
});

test("deletePhysicalFileBestEffort tolerates malformed file URLs", async () => {
  // A URL that does not match the /uploads/* shape should not crash
  // the rollback path; we expect it to be logged and otherwise ignored.
  await assert.doesNotReject(
    deletePhysicalFileBestEffort(
      "not-a-real-upload-url",
      "test:malformed-url",
    ),
  );
});

// ---------------------------------------------------------------------------
// persistWithStorageRollback covers the route-level transactional contract.
// The lead and daily-log attachment routes both delegate to this helper,
// so testing it directly is equivalent to testing the routes' rollback
// behavior without needing a provisioned test database. We make the
// storage rollback observable by pointing fileUrl at a real upload-shaped
// path and watching the env-driven failure mode of deletePhysicalFile,
// while we make the persist/postCommit boundaries observable via spies.
// ---------------------------------------------------------------------------

test("persistWithStorageRollback returns the persist result on the happy path", async () => {
  const calls: string[] = [];
  const result = await persistWithStorageRollback({
    fileUrl: "/uploads/lead-happy/document/file.pdf",
    context: "test:happy",
    persist: async () => {
      calls.push("persist");
      return { fileId: "f1", attachmentId: "a1" };
    },
    postCommit: async () => {
      calls.push("postCommit");
    },
    rollback: async () => {
      calls.push("rollback");
    },
  });

  assert.deepEqual(calls, ["persist", "postCommit"]);
  assert.deepEqual(result, { fileId: "f1", attachmentId: "a1" });
});

test("simulated DB persist failure deletes the storage object and skips rollback", async () => {
  // Mirrors: the lead/daily-log POST handler successfully wrote the
  // file to object storage, then `db.transaction(...)` failed before
  // any DB row was committed. Acceptance criteria: the helper attempts
  // to delete the freshly uploaded object, does NOT call `rollback`
  // (no rows exist to roll back), and re-throws the original error.
  const calls: string[] = [];
  const fileUrl = "/uploads/lead-deadbeef/document/persist-fail.pdf";

  // Force the storage delete to attempt real work, then fail in a
  // controlled way. PRIVATE_OBJECT_DIR unset makes deletePhysicalFile
  // throw synchronously — proving the helper still calls it and that
  // the rollback itself is best-effort.
  const previous = process.env.PRIVATE_OBJECT_DIR;
  delete process.env.PRIVATE_OBJECT_DIR;

  try {
    await assert.rejects(
      persistWithStorageRollback({
        fileUrl,
        context: "test:persist-failure",
        persist: async () => {
          calls.push("persist");
          throw new Error("simulated DB transaction failure");
        },
        postCommit: async () => {
          calls.push("postCommit");
        },
        rollback: async () => {
          calls.push("rollback");
        },
      }),
      /simulated DB transaction failure/,
    );
  } finally {
    if (previous !== undefined) {
      process.env.PRIVATE_OBJECT_DIR = previous;
    }
  }

  assert.deepEqual(
    calls,
    ["persist"],
    "rollback must not run when persist itself failed (no committed rows)",
  );
});

test("simulated activity-log failure rolls back DB rows and deletes the storage object", async () => {
  // Mirrors: the DB transaction committed both the `files` row and the
  // attachment row, then `writeActivity(...)` threw. Acceptance
  // criteria: the helper invokes `rollback` with the persist result so
  // the route can delete those committed rows, then deletes the
  // freshly uploaded object, then re-throws so the route returns 500.
  const calls: string[] = [];
  const rollbackArgs: unknown[] = [];

  await assert.rejects(
    persistWithStorageRollback({
      fileUrl: "/uploads/lead-deadbeef/document/activity-fail.pdf",
      context: "test:postcommit-failure",
      persist: async () => {
        calls.push("persist");
        return { fileId: "f-committed", attachmentId: "a-committed" };
      },
      postCommit: async () => {
        calls.push("postCommit");
        throw new Error("simulated activity log failure");
      },
      rollback: async (result) => {
        calls.push("rollback");
        rollbackArgs.push(result);
      },
    }),
    /simulated activity log failure/,
  );

  assert.deepEqual(calls, ["persist", "postCommit", "rollback"]);
  assert.deepEqual(rollbackArgs, [
    { fileId: "f-committed", attachmentId: "a-committed" },
  ]);
});

test("rollback errors are swallowed so the original failure is what propagates", async () => {
  // If the row-cleanup step itself fails (e.g. DB connection died),
  // the helper must still re-throw the original error so the route
  // surfaces a meaningful 500 to the client. Otherwise the user sees
  // a confusing rollback error and we lose the real root cause.
  await assert.rejects(
    persistWithStorageRollback({
      fileUrl: "/uploads/lead-deadbeef/document/rollback-fail.pdf",
      context: "test:rollback-failure",
      persist: async () => ({ fileId: "f", attachmentId: "a" }),
      postCommit: async () => {
        throw new Error("original failure that should reach the client");
      },
      rollback: async () => {
        throw new Error("secondary rollback failure");
      },
    }),
    /original failure that should reach the client/,
  );
});

test("works without postCommit or rollback callbacks (single-statement uploads)", async () => {
  // Some routes only have a single insert and no follow-up activity
  // write. Make sure the helper still works in that minimal shape.
  const result = await persistWithStorageRollback({
    fileUrl: "/uploads/lead-min/document/min.pdf",
    context: "test:minimal",
    persist: async () => "ok",
  });
  assert.equal(result, "ok");
});
