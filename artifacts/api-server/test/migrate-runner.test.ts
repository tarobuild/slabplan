import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";

import { applyMigrations, recordBaselineIfNeeded } from "@workspace/db/migrate";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.CADSTONE_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

// Each test runs inside its own throwaway schema so the migrations
// runner can use unqualified table names against a clean namespace
// without disturbing the shared `public` schema (which other suites
// depend on).
const sharedPool = new pg.Pool({ connectionString: testDatabaseUrl });

before(async () => {
  // Sanity check that the test DB is reachable.
  const probe = await sharedPool.connect();
  probe.release();
});

after(async () => {
  await sharedPool.end();
});

async function withScratchSchema<T>(
  fn: (scratchPool: pg.Pool, schemaName: string) => Promise<T>,
): Promise<T> {
  const schemaName = `migrate_test_${crypto.randomUUID().replace(/-/g, "")}`;
  const safeIdent = `"${schemaName.replace(/"/g, '""')}"`;

  const setupClient = await sharedPool.connect();
  try {
    await setupClient.query(`create schema ${safeIdent}`);
  } finally {
    setupClient.release();
  }

  const scratchPool = new pg.Pool({
    connectionString: testDatabaseUrl,
    // Pin every checkout from this pool to the scratch schema so the
    // migration runner's unqualified DDL targets it.
    options: `-c search_path=${schemaName}`,
  });

  try {
    return await fn(scratchPool, schemaName);
  } finally {
    await scratchPool.end();
    const teardownClient = await sharedPool.connect();
    try {
      await teardownClient.query(`drop schema ${safeIdent} cascade`);
    } finally {
      teardownClient.release();
    }
  }
}

test(
  "recordBaselineIfNeeded does nothing on a truly empty database",
  async () => {
    await withScratchSchema(async (scratchPool) => {
      const client = await scratchPool.connect();
      try {
        const baselined = await recordBaselineIfNeeded(client);
        assert.deepEqual(baselined, []);

        const { rows } = await client.query<{ filename: string }>(
          "select filename from workspace_schema_migrations",
        );
        assert.deepEqual(
          rows,
          [],
          "ledger should stay empty when there is no pre-pushed schema",
        );
      } finally {
        client.release();
      }
    });
  },
);

test(
  "recordBaselineIfNeeded backfills 0000 when sentinel exists and ledger is missing",
  async () => {
    await withScratchSchema(async (scratchPool) => {
      const client = await scratchPool.connect();
      try {
        // Simulate a database that was bootstrapped via drizzle-kit push:
        // the baseline `users` table exists but the ledger does not.
        await client.query(`create table users (id uuid primary key)`);

        const baselined = await recordBaselineIfNeeded(client);
        assert.deepEqual(baselined, ["0000_far_doctor_strange.sql"]);

        const { rows } = await client.query<{ filename: string }>(
          "select filename from workspace_schema_migrations order by filename",
        );
        assert.deepEqual(
          rows.map((r) => r.filename),
          ["0000_far_doctor_strange.sql"],
        );
      } finally {
        client.release();
      }
    });
  },
);

test(
  "recordBaselineIfNeeded backfills 0000 when ledger exists but is empty",
  async () => {
    await withScratchSchema(async (scratchPool) => {
      const client = await scratchPool.connect();
      try {
        // Simulate the ledger being created out-of-band (or truncated).
        await client.query(`create table users (id uuid primary key)`);
        await client.query(`
          create table workspace_schema_migrations (
            filename text primary key,
            checksum text not null,
            applied_at timestamptz not null default now()
          )
        `);

        const baselined = await recordBaselineIfNeeded(client);
        assert.deepEqual(baselined, ["0000_far_doctor_strange.sql"]);

        const { rows } = await client.query<{ filename: string }>(
          "select filename from workspace_schema_migrations order by filename",
        );
        assert.deepEqual(
          rows.map((r) => r.filename),
          ["0000_far_doctor_strange.sql"],
        );
      } finally {
        client.release();
      }
    });
  },
);

test(
  "recordBaselineIfNeeded is a no-op when the baseline is already recorded",
  async () => {
    await withScratchSchema(async (scratchPool) => {
      const client = await scratchPool.connect();
      try {
        await client.query(`create table users (id uuid primary key)`);
        await client.query(`
          create table workspace_schema_migrations (
            filename text primary key,
            checksum text not null,
            applied_at timestamptz not null default now()
          )
        `);
        await client.query(
          `insert into workspace_schema_migrations (filename, checksum)
             values ('0000_far_doctor_strange.sql', 'sentinel-checksum')`,
        );

        const baselined = await recordBaselineIfNeeded(client);
        assert.deepEqual(baselined, []);

        const { rows } = await client.query<{ filename: string; checksum: string }>(
          "select filename, checksum from workspace_schema_migrations",
        );
        assert.deepEqual(rows, [
          {
            filename: "0000_far_doctor_strange.sql",
            checksum: "sentinel-checksum",
          },
        ]);
      } finally {
        client.release();
      }
    });
  },
);

async function withScratchDatabase<T>(
  fn: (scratchPool: pg.Pool) => Promise<T>,
): Promise<T> {
  // 0008 introduces a CREATE TYPE that's gated on a cluster-wide
  // pg_type lookup, so a temp schema isn't enough — we need a fresh
  // database to exercise the full migration sequence in isolation.
  const url = new URL(testDatabaseUrl);
  const dbName = `migrate_test_${crypto.randomUUID().replace(/-/g, "")}`;

  const maintenanceUrl = new URL(url.toString());
  maintenanceUrl.pathname = "/postgres";
  const maintClient = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await maintClient.connect();
  try {
    await maintClient.query(`create database "${dbName}"`);
  } finally {
    await maintClient.end().catch(() => undefined);
  }

  const scratchUrl = new URL(url.toString());
  scratchUrl.pathname = `/${dbName}`;
  const scratchPool = new pg.Pool({ connectionString: scratchUrl.toString() });

  try {
    return await fn(scratchPool);
  } finally {
    await scratchPool.end().catch(() => undefined);

    const cleanup = new pg.Client({ connectionString: maintenanceUrl.toString() });
    await cleanup.connect();
    try {
      // Force-disconnect any lingering sessions so DROP DATABASE can succeed.
      await cleanup.query(
        `select pg_terminate_backend(pid)
           from pg_stat_activity
          where datname = $1
            and pid <> pg_backend_pid()`,
        [dbName],
      );
      await cleanup.query(`drop database if exists "${dbName}"`);
    } finally {
      await cleanup.end().catch(() => undefined);
    }
  }
}

test(
  "applyMigrations against a pre-pushed schema baselines 0000 and applies the rest cleanly",
  async () => {
    await withScratchDatabase(async (scratchPool) => {
      // Stand up a minimal "drizzle-kit push" baseline: just the tables
      // and columns that 0004-0009 actually touch, so the idempotent
      // post-baseline migrations can run against it without us having to
      // execute the non-idempotent 0000.
      const setupClient = await scratchPool.connect();
      try {
        await setupClient.query(`
          create table users (
            id uuid primary key,
            created_at timestamp with time zone default now() not null,
            updated_at timestamp with time zone default now() not null
          );
          create table jobs (
            id uuid primary key
          );
          create table leads (
            id uuid primary key
          );
          create table daily_logs (
            id uuid primary key
          );
          create table schedule_items (
            id uuid primary key
          );
          create table folders (
            id uuid primary key,
            title varchar(255) not null,
            job_id uuid references jobs(id) on delete cascade,
            parent_folder_id uuid,
            media_type varchar(50) not null,
            deleted_at timestamp with time zone
          );
          create table files (
            id uuid primary key,
            folder_id uuid references folders(id) on delete cascade,
            created_at timestamp with time zone default now() not null
          );
          create table daily_log_settings (
            id uuid primary key,
            singleton boolean not null default true
          );
        `);
      } finally {
        setupClient.release();
      }

      const result = await applyMigrations(scratchPool);

      assert.deepEqual(
        result.baselined,
        ["0000_far_doctor_strange.sql"],
        "0000 should be recorded as already-applied, not executed",
      );

      const expectedApplied = [
        "0004_files-folder-created-id-index.sql",
        "0005_pat-and-idempotency.sql",
        "0006_agent.sql",
        "0007_user_invitations.sql",
        "0008_folder_scope_columns.sql",
        "0009_schema_audit_alignment.sql",
      ];
      assert.deepEqual(
        result.applied.sort(),
        expectedApplied.sort(),
        "every migration after the baseline must apply on top of the pushed schema",
      );

      // A second pass must be a complete no-op (idempotency check).
      const second = await applyMigrations(scratchPool);
      assert.deepEqual(second.baselined, []);
      assert.deepEqual(second.applied, []);
      assert.deepEqual(
        second.skipped.sort(),
        ["0000_far_doctor_strange.sql", ...expectedApplied].sort(),
      );

      // Verify the post-baseline migrations actually produced their
      // schema changes (sanity check that they didn't silently fail).
      const verifyClient = await scratchPool.connect();
      try {
        const { rows: scopeColumn } = await verifyClient.query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_name = 'folders' and column_name = 'scope'`,
        );
        assert.equal(scopeColumn.length, 1, "folders.scope should exist after 0008");

        const { rows: jobAssignees } = await verifyClient.query<{ exists: boolean }>(
          `select to_regclass('job_assignees') is not null as exists`,
        );
        assert.equal(jobAssignees[0].exists, true, "job_assignees should exist after 0009");
      } finally {
        verifyClient.release();
      }
    });
  },
);
