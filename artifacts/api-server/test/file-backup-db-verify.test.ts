import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { after, before, describe, test } from "node:test";

const pgRestore = await import("../scripts/lib/pg-restore.mjs");
const dbVerify = await import("../scripts/file-backup-db-verify.mjs");

const scratch = await mkdtemp(path.join(os.tmpdir(), "slabplan-db-verify-test-"));
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function writeDump(name: string, sql: string, { gzip = true } = {}) {
  const file = path.join(scratch, `${name}-${randomBytes(4).toString("hex")}.sql${gzip ? ".gz" : ""}`);
  await writeFile(file, gzip ? gzipSync(Buffer.from(sql)) : sql);
  return file;
}

describe("fail-closed restore streaming (fake psql, runs everywhere)", () => {
  let fakePsql = "";

  before(async () => {
    // Emulates psql's restore behavior: ERROR/NOTICE lines on stderr, stdout
    // ignored, and an exit status. Driven by marker comments in the dump.
    fakePsql = path.join(scratch, "fake-psql");
    await writeFile(
      fakePsql,
      `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let exitCode = 0;
  input.split("\\n").forEach((line, index) => {
    let match;
    if ((match = /^-- FAKE-ERROR: (.*)$/.exec(line))) process.stderr.write("psql:<stdin>:" + (index + 1) + ": ERROR:  " + match[1] + "\\n");
    if ((match = /^-- FAKE-NOTICES: (\\d+)$/.exec(line))) for (let i = 0; i < Number(match[1]); i++) process.stderr.write("psql:<stdin>:" + (index + 1) + ": NOTICE:  relation already exists, skipping " + i + "\\n");
    if ((match = /^-- FAKE-EXIT: (\\d+)$/.exec(line))) exitCode = Number(match[1]);
    process.stdout.write("row data that must never be reported\\n");
  });
  process.exit(exitCode);
});
`,
    );
    await chmod(fakePsql, 0o755);
  });

  const restoreWith = async (sql: string, options: { gzip?: boolean; corrupt?: boolean } = {}) => {
    let dump = await writeDump("fake", sql, { gzip: options.gzip ?? true });
    if (options.corrupt) {
      const bytes = await readFile(dump);
      dump = path.join(scratch, `corrupt-${randomBytes(4).toString("hex")}.sql.gz`);
      await writeFile(dump, bytes.subarray(0, Math.max(10, bytes.length - 12)));
    }
    return pgRestore.restorePlainSqlDump({ dumpPath: dump, databaseUrl: "postgres://unused.invalid/db", psqlBin: fakePsql });
  };

  test("tolerates only the explicit Supabase compatibility errors", async () => {
    const result = await restoreWith(`CREATE EXTENSION supabase_vault;\n-- FAKE-ERROR: extension "supabase_vault" is not available\nselect 1;\n`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.allowedErrorCount, 1);
    assert.equal(result.unexpectedErrorCount, 0);
  });

  test("any other SQL error fails the restore, with values redacted", async () => {
    await assert.rejects(
      restoreWith(`-- FAKE-ERROR: insert or update on table "files" violates foreign key constraint "files_org_fkey"\n-- FAKE-ERROR: invalid input syntax for type uuid: "customer-secret-value"\n`),
      (error: Error & { result: { unexpectedErrorCount: number; unexpectedErrors: string[] } }) => {
        assert.match(error.message, /2 unexpected SQL error/);
        assert.equal(error.result.unexpectedErrorCount, 2);
        assert.ok(!error.message.includes("customer-secret-value"), "values must be redacted");
        assert.ok(!error.message.includes("row data"), "stdout must never be reported");
        return true;
      },
    );
  });

  test("an early error cannot scroll out of view behind later output", async () => {
    await assert.rejects(
      restoreWith(`-- FAKE-ERROR: relation "public.jobs" does not exist\n-- FAKE-NOTICES: 4000\n`),
      /1 unexpected SQL error/,
    );
  });

  test("a non-zero psql exit or a broken dump stream fails", async () => {
    await assert.rejects(restoreWith(`select 1;\n-- FAKE-EXIT: 3\n`), /psql exited with code 3/);
    await assert.rejects(restoreWith(`select 1;\n`.repeat(2000), { corrupt: true }), /could not be streamed/);
  });

  test("redaction removes quoted values and key details", () => {
    const line = `psql:<stdin>:9: ERROR:  duplicate key value violates unique constraint "users_email_key" DETAIL: Key (email)=(owner@example.com) already exists 'x'`;
    const redacted = pgRestore.redactRestoreError(line);
    assert.ok(!redacted.includes("owner@example.com"));
    assert.ok(!redacted.startsWith("psql:"));
    assert.match(redacted, /^ERROR:/);
  });
});

const psqlAvailable = spawnSync("psql", ["--version"], { stdio: "ignore" }).status === 0;
const adminUrl = (() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test");
  url.pathname = "/postgres";
  return url.toString();
})();
const skip = psqlAvailable ? false : "psql is not installed in this environment (the fake-psql tests above still run)";

describe("real PostgreSQL restore fixtures", { skip }, () => {
  const migrationsDir = path.join(scratch, "migrations");
  const baseTables = `
CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE TABLE public.workspace_schema_migrations (filename text PRIMARY KEY, checksum text NOT NULL);
CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.users (id uuid PRIMARY KEY, organization_id uuid REFERENCES public.organizations(id), email text NOT NULL UNIQUE);
CREATE TABLE public.files (id uuid PRIMARY KEY, organization_id uuid REFERENCES public.organizations(id), file_url varchar(500), file_size bigint, deleted_at timestamptz);
`;
  const ledger = (names: string[]) => `COPY public.workspace_schema_migrations (filename, checksum) FROM stdin;\n${names.map((name) => `${name}\tchecksum`).join("\n")}\n\\.\n`;
  const data = `
COPY public.organizations (id, name) FROM stdin;
11111111-1111-4111-8111-111111111111\tTEST Organization
\\.
COPY public.users (id, organization_id, email) FROM stdin;
22222222-2222-4222-8222-222222222222\t11111111-1111-4111-8111-111111111111\ttest-owner@example.test
\\.
INSERT INTO public.files VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '/uploads/organizations/11111111-1111-4111-8111-111111111111/job/documents/a.pdf', 10, NULL);
`;
  const required = ["organizations", "users", "files", "workspace_schema_migrations"];

  before(async () => {
    await mkdir(migrationsDir);
    await writeFile(path.join(migrationsDir, "0000_base.sql"), `-- base\nCREATE TABLE "organizations" (id uuid);\nCREATE TABLE IF NOT EXISTS "public"."users" (id uuid);\nCREATE TABLE files (id uuid);\n`);
    await writeFile(path.join(migrationsDir, "0001_billing.sql"), `CREATE TABLE IF NOT EXISTS billing_events (id text);\n`);
  });

  const verify = (dumpSql: string, options: { applied?: string[] } = {}) =>
    (async () => {
      const dump = await writeDump("real", `${baseTables}${ledger(options.applied ?? ["0000_base.sql"])}${dumpSql}`);
      const logs: string[] = [];
      return await dbVerify.verifyDatabaseDump({
        dumpPath: dump,
        adminUrl,
        psqlBin: "psql",
        migrationsDir,
        requiredTables: required,
        log: (line: string) => logs.push(line),
      });
    })();

  test("an intact dump restores and verifies, exporting only live file rows", async () => {
    const dump = await writeDump("intact", `${baseTables}${ledger(["0000_base.sql"])}${data}INSERT INTO public.files VALUES ('44444444-4444-4444-8444-444444444444', NULL, '/uploads/deleted.pdf', 1, now());\n`);
    const csv = path.join(scratch, `files-${randomBytes(4).toString("hex")}.csv`);
    const result = await dbVerify.verifyDatabaseDump({ dumpPath: dump, filesCsvPath: csv, adminUrl, psqlBin: "psql", migrationsDir, requiredTables: required, log: () => {} });
    assert.equal(result.restored.allowedErrorCount >= 1, true, "the Supabase Vault extension error is tolerated");
    assert.equal(result.verified.ok, true, result.verified.problems.join("; "));
    assert.equal(result.verified.migrationsBehind, 1);
    const rows = (await readFile(csv, "utf8")).trim().split("\n");
    assert.deepEqual(rows, ["33333333-3333-4333-8333-333333333333,11111111-1111-4111-8111-111111111111,/uploads/organizations/11111111-1111-4111-8111-111111111111/job/documents/a.pdf,10"]);
  });

  test("a foreign-key violation during restore fails the drill", async () => {
    await assert.rejects(
      verify(`${data}INSERT INTO public.files VALUES ('55555555-5555-4555-8555-555555555555', '99999999-9999-4999-8999-999999999999', '/uploads/x.pdf', 1, NULL);\n`),
      /unexpected SQL error/,
    );
  });

  test("an unexpected error hidden behind many notices still fails", async () => {
    const notices = "DO $$ BEGIN FOR i IN 1..3000 LOOP RAISE NOTICE 'filler notice %', i; END LOOP; END $$;\n";
    await assert.rejects(verify(`${data}SELECT * FROM public.missing_table;\n${notices}`), /unexpected SQL error/);
  });

  test("tables created by applied migrations must exist", async () => {
    await assert.rejects(verify(data, { applied: ["0000_base.sql", "0001_billing.sql"] }), /tables created by applied migrations are missing: billing_events/);
  });

  test("empty core tables and unknown migrations fail verification", async () => {
    await assert.rejects(verify(""), /table organizations is empty; table users is empty/);
    await assert.rejects(verify(data, { applied: ["0000_base.sql", "9999_foreign.sql"] }), /applied migration\(s\) are not in this repository/);
  });

  test("intentional NOT VALID constraints are preserved, but violations of validated ones fail", async () => {
    // Migration 0033 adds tenant composite foreign keys NOT VALID; pg_dump keeps them that way.
    const preserved = await verify(`${data}ALTER TABLE public.files ADD CONSTRAINT files_size_positive CHECK (file_size > 0) NOT VALID;\n`);
    assert.equal(preserved.verified.ok, true);
    await assert.rejects(
      verify(`${data}ALTER TABLE public.files ADD CONSTRAINT files_size_large CHECK (file_size > 1000);\n`),
      /unexpected SQL error/,
    );
  });

  test("scratch databases are always dropped", async () => {
    await assert.rejects(verify(`SELECT * FROM public.missing_table;\n`));
    const leftover = spawnSync("psql", ["--dbname", adminUrl, "-X", "-At", "-c", "select count(*) from pg_database where datname like 'slabplan_backup_verify_%'"], { encoding: "utf8" });
    assert.equal(leftover.stdout.trim(), "0");
  });

  test("an unreachable database fails instead of passing silently", async () => {
    const dump = await writeDump("unreachable", `${baseTables}${data}`);
    await assert.rejects(
      pgRestore.restorePlainSqlDump({ dumpPath: dump, databaseUrl: `${adminUrl.replace(/\/postgres$/, "")}/slabplan_missing_${randomBytes(4).toString("hex")}`, psqlBin: "psql" }),
      /psql exited with code|could not be streamed/,
    );
  });
});
