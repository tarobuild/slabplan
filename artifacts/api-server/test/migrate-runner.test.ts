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
            id uuid primary key,
            client_id uuid,
            contract_type varchar(50),
            updated_at timestamp with time zone default now() not null
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
          create table clients (
            id uuid primary key,
            company_name varchar(255) not null,
            client_id uuid,
            notes text,
            created_at timestamp with time zone default now() not null,
            updated_at timestamp with time zone default now() not null
          );
          create table client_contacts (
            id uuid primary key,
            client_id uuid references clients(id) on delete cascade not null,
            first_name varchar(100),
            last_name varchar(100),
            created_at timestamp with time zone default now() not null,
            updated_at timestamp with time zone default now() not null
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
        "0010_clients_first_money.sql",
        "0011_financial_tracker.sql",
        "0012_schema_hardening.sql",
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

        // 0012 — schema hardening checks. Each CHECK should reject the
        // matching bad insert; cascades and NOT NULL guards must hold.

        // jobs.contract_type CHECK rejects unknown values.
        await assert.rejects(
          verifyClient.query(
            `insert into jobs (id, contract_type, updated_at)
               values ('11111111-1111-1111-1111-111111111111', 'bogus', now())`,
          ),
          /jobs_contract_type_check/i,
          "jobs.contract_type CHECK must reject non-enum values",
        );

        // folders.media_type CHECK rejects unknown values. We need a
        // valid `scope` (added in 0008) to satisfy notNull.
        await assert.rejects(
          verifyClient.query(
            `insert into folders (id, title, scope, media_type)
               values ('22222222-2222-2222-2222-222222222222', 'x',
                       'resource', 'audio')`,
          ),
          /folders_media_type_check/i,
          "folders.media_type CHECK must reject non-enum values",
        );

        // client_contacts CHECK rejects rows with neither name set.
        await verifyClient.query(
          `insert into clients (id, company_name)
             values ('33333333-3333-3333-3333-333333333333', 'Acme')`,
        );
        await assert.rejects(
          verifyClient.query(
            `insert into client_contacts (id, client_id, first_name, last_name)
               values ('44444444-4444-4444-4444-444444444444',
                       '33333333-3333-3333-3333-333333333333',
                       null, null)`,
          ),
          /client_contacts_name_present_check/i,
          "client_contacts CHECK must reject rows with no name at all",
        );

        // agent_messages.stopped_reason CHECK rejects unknown values.
        // agent_conversations + agent_messages were created by 0006.
        await verifyClient.query(
          `insert into users (id) values ('77777777-7777-7777-7777-777777777777')`,
        );
        await verifyClient.query(
          `insert into agent_conversations (id, user_id)
             values ('88888888-8888-8888-8888-888888888888',
                     '77777777-7777-7777-7777-777777777777')`,
        );
        await assert.rejects(
          verifyClient.query(
            `insert into agent_messages (id, conversation_id, role, stopped_reason)
               values ('99999999-9999-9999-9999-999999999999',
                       '88888888-8888-8888-8888-888888888888',
                       'assistant', 'definitely_not_a_real_reason')`,
          ),
          /agent_messages_stopped_reason_check/i,
          "agent_messages.stopped_reason CHECK must reject non-enum values",
        );

        // financial_trackers.job_id cascades on jobs delete.
        await verifyClient.query(
          `insert into jobs (id, client_id, updated_at)
             values ('55555555-5555-5555-5555-555555555555',
                     '33333333-3333-3333-3333-333333333333', now())`,
        );
        await verifyClient.query(
          `insert into financial_trackers (id, job_id, created_at, updated_at)
             values ('66666666-6666-6666-6666-666666666666',
                     '55555555-5555-5555-5555-555555555555', now(), now())`,
        );
        await verifyClient.query(
          `delete from jobs where id = '55555555-5555-5555-5555-555555555555'`,
        );
        const { rows: trackerRows } = await verifyClient.query<{ count: string }>(
          `select count(*)::text as count from financial_trackers
             where id = '66666666-6666-6666-6666-666666666666'`,
        );
        assert.equal(
          trackerRows[0].count,
          "0",
          "financial_trackers row must cascade away when its job is deleted",
        );
      } finally {
        verifyClient.release();
      }
    });
  },
);
