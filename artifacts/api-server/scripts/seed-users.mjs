/**
 * seed-users.mjs - upsert Stone Track admin fixtures into a database, plus
 * a synthetic crew_member fixture and a baseline E2E client + open job
 * for the Playwright e2e suite when seeding the local database.
 *
 * Usage:
 *   SEED_ADMIN_PRIMARY_PASSWORD=... SEED_ADMIN_SECONDARY_PASSWORD=... \
 *     SEED_WORKER_FIXTURE_PASSWORD=... \
 *     node artifacts/api-server/scripts/seed-users.mjs --db=local
 *
 *   SEED_ADMIN_PRIMARY_PASSWORD=... SEED_ADMIN_SECONDARY_PASSWORD=... \
 *     node artifacts/api-server/scripts/seed-users.mjs \
 *     --db=production --i-know-what-im-doing
 *
 * Required arguments:
 *   --db=local        seed the local database (uses DATABASE_URL).
 *                     Also seeds a baseline E2E fixture (one client +
 *                     one open job) so the Playwright suite has
 *                     something to attach `pickAnyClient` /
 *                     `pickAnyJob` results to. Production never
 *                     receives the fixture.
 *   --db=production   seed the live database (uses SUPABASE_DATABASE_URL)
 *                     and ALSO requires --i-know-what-im-doing.
 *
 * Required env vars (admins, both targets):
 *   SEED_ADMIN_PRIMARY_PASSWORD     password for admin-primary@stone-track.test
 *   SEED_ADMIN_SECONDARY_PASSWORD   password for admin-secondary@stone-track.test
 *
 * Required env vars (local only — worker fixture):
 *   SEED_WORKER_FIXTURE_PASSWORD  password for worker@stone-track.test
 *                                 (the synthetic crew_member account used
 *                                 by the Playwright suite). The Playwright
 *                                 helpers in artifacts/cadstone/tests/e2e/
 *                                 also read this env var; keep them in sync.
 *
 * All passwords must be at least 12 characters and must not match obvious
 * weak patterns (e.g. "Test1!", "password", "admin", or all-numeric
 * strings). Worker fixture follows the same rules as the admins — there is
 * intentionally no fallback, even though the worker user is local-only.
 *
 * Where the env vars come from:
 *   - Local:      set them inline on the command line, or in your shell.
 *   - Production: set the admin secrets as Replit Secrets just-in-time,
 *                 then UNSET them again after running. Never check them
 *                 into the repo. Production NEVER seeds the worker fixture.
 *
 * IMPORTANT — rotating production passwords:
 *   This script does NOT rotate live passwords. If you suspect a password has
 *   leaked (e.g. it appeared in git history), rotate it OUTSIDE this script:
 *   change it directly in the production database (via the Supabase / DB
 *   console) or by issuing the equivalent UPDATE against `users.password_hash`.
 *   Re-running this script with a new SEED_ADMIN_*_PASSWORD will only affect
 *   users that do not already exist — it deliberately does not overwrite an
 *   existing row's password.
 */

import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcrypt";

// `pg` is only declared as a dependency of @workspace/db, so resolve it
// through lib/db's own node_modules instead of the api-server's.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(
  path.resolve(__dirname, "../../../lib/db/package.json"),
);
const { Client } = dbRequire("pg");

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 12;
const PRODUCTION_PAUSE_MS = 3000;

// Admin fixture identities. Production onboarding should create real
// tenant users through the app flow. Passwords are intentionally NOT in
// this file; they come from environment variables at runtime.
// See file header for usage.
export const SEED_USER_IDENTITIES = [
  {
    fullName: "Primary Admin",
    email: "admin-primary@stone-track.test",
    role: "admin",
    passwordEnvVar: "SEED_ADMIN_PRIMARY_PASSWORD",
  },
  {
    fullName: "Secondary Admin",
    email: "admin-secondary@stone-track.test",
    role: "admin",
    passwordEnvVar: "SEED_ADMIN_SECONDARY_PASSWORD",
  },
];

// Synthetic crew_member fixture used by the Playwright e2e suite to assert
// worker-level role gates actually fire. Real workers are added through
// the in-app invite flow, never seeded. This fixture is only attached to
// the LOCAL target (see TARGETS.local.extraIdentities); production never
// gets it. Same hardening rules as the admin seed: env-driven password
// validated through validatePassword, no fallback.
export const WORKER_FIXTURE_IDENTITY = {
  fullName: "Worker Fixture",
  email: "worker@stone-track.test",
  role: "crew_member",
  passwordEnvVar: "SEED_WORKER_FIXTURE_PASSWORD",
};

// Baseline data the Playwright e2e suite expects to find. The suite's
// `pickAnyClient` / `pickAnyJob` helpers used to silently `test.skip` on
// a clean local DB; seeding these here keeps the suite running all
// specs against a freshly-recreated database. Both rows are upserted by
// a stable identifier (company_name / title) so re-running the seed is
// idempotent. Production never gets these — they live behind the
// `seedsLocalFixtures` flag below.
export const LOCAL_FIXTURE_CLIENT = {
  companyName: "E2E Fixture Client",
  email: "fixture-client@stone-track.test",
};

export const LOCAL_FIXTURE_JOB = {
  title: "E2E Fixture Job",
  status: "open",
  jobType: "custom",
  contractType: "fixed_price",
};

export const TARGETS = {
  local: {
    label: "LOCAL",
    envVar: "DATABASE_URL",
    // Local also seeds the worker fixture so the Playwright suite can
    // exercise role-gated paths against a true crew_member user.
    extraIdentities: [WORKER_FIXTURE_IDENTITY],
    // Local also seeds the baseline client + job the Playwright suite
    // looks up via pickAnyClient / pickAnyJob.
    seedsLocalFixtures: true,
  },
  production: {
    label: "PRODUCTION",
    envVar: "SUPABASE_DATABASE_URL",
    extraIdentities: [],
    seedsLocalFixtures: false,
  },
};

// Obvious weak-password patterns we refuse to use. These are matched
// case-insensitively against the password as a whole substring, plus a
// dedicated all-numeric check.
const WEAK_PASSWORD_PATTERNS = [
  "test",
  "password",
  "passw0rd",
  "admin",
  "letmein",
  "welcome",
  "qwerty",
  "stone track",
  "stonetrack",
  "changeme",
  "default",
];

export function parseArgs(argv) {
  let db = null;
  let confirmed = false;
  for (const arg of argv) {
    if (arg === "--db=local") {
      db = "local";
    } else if (arg === "--db=production") {
      db = "production";
    } else if (arg.startsWith("--db=")) {
      throw new Error(
        `Unknown --db value: ${arg}. Expected --db=local or --db=production.`,
      );
    } else if (arg === "--i-know-what-im-doing") {
      confirmed = true;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }

  if (!db) {
    throw new Error(
      "Missing required --db flag. Pass --db=local or --db=production. " +
        "Production also requires --i-know-what-im-doing.",
    );
  }

  if (db === "production" && !confirmed) {
    throw new Error(
      "Refusing to seed PRODUCTION without --i-know-what-im-doing. " +
        "Re-run with both --db=production and --i-know-what-im-doing if you " +
        "really mean it.",
    );
  }

  return { db, confirmed };
}

export function validatePassword(password, envVar) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error(
      `Missing required env var ${envVar}. Set it to a strong password before running this script.`,
    );
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `${envVar} is too short (${password.length} chars). Require at least ${MIN_PASSWORD_LENGTH}.`,
    );
  }

  if (/^\d+$/.test(password)) {
    throw new Error(
      `${envVar} is all numeric. Use a password with mixed character classes.`,
    );
  }

  const lowered = password.toLowerCase();
  for (const pattern of WEAK_PASSWORD_PATTERNS) {
    if (lowered.includes(pattern)) {
      throw new Error(
        `${envVar} contains a weak/blocked pattern ("${pattern}"). Choose a stronger password.`,
      );
    }
  }
}

export function resolveSeedUsers(env, identities = SEED_USER_IDENTITIES) {
  return identities.map((identity) => {
    const password = env[identity.passwordEnvVar];
    validatePassword(password, identity.passwordEnvVar);
    return {
      fullName: identity.fullName,
      email: identity.email,
      role: identity.role,
      password,
    };
  });
}

// Stateful upsert of the baseline E2E client + open job. Uses
// company_name / title as the natural key (both are soft-delete aware,
// so we filter on deleted_at IS NULL to mirror how the API surfaces
// them). Attaches the rows to the first admin user (Cesar) for
// `created_by`, which is allowed to be null but is more useful as a
// real id when debugging the seeded fixture.
//
// When the fixture rows already exist, we re-assert the canonical
// values (job.status=open, job.client_id linked to the fixture client,
// etc.). That way a local DB that has drifted — for example because a
// previous run mutated job.status to "closed" — self-heals on the next
// seed instead of leaving the e2e suite running against malformed
// fixtures.
async function seedLocalFixtures(client, label) {
  const adminEmail = SEED_USER_IDENTITIES[0].email;
  const adminLookup = await client.query(
    "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1",
    [adminEmail],
  );
  const adminId = adminLookup.rows[0]?.id ?? null;

  if (!adminId) {
    throw new Error(
      `[${label}] Cannot seed E2E fixtures: admin user ${adminEmail} not found. ` +
        `Make sure the user-seed step ran successfully first.`,
    );
  }

  const existingClient = await client.query(
    "SELECT id FROM clients WHERE company_name = $1 AND deleted_at IS NULL LIMIT 1",
    [LOCAL_FIXTURE_CLIENT.companyName],
  );

  let clientRowId;
  if (existingClient.rowCount && existingClient.rowCount > 0) {
    clientRowId = existingClient.rows[0].id;
    // Re-assert the canonical email + created_by so a hand-edited
    // fixture row converges back on the expected shape.
    await client.query(
      `UPDATE clients
          SET email = $2,
              created_by = $3
        WHERE id = $1`,
      [clientRowId, LOCAL_FIXTURE_CLIENT.email, adminId],
    );
    console.log(
      `[${label}] E2E fixture client already exists, re-asserted canonical fields: "${LOCAL_FIXTURE_CLIENT.companyName}"`,
    );
  } else {
    clientRowId = crypto.randomUUID();
    await client.query(
      `INSERT INTO clients (id, company_name, email, created_by)
       VALUES ($1, $2, $3, $4)`,
      [
        clientRowId,
        LOCAL_FIXTURE_CLIENT.companyName,
        LOCAL_FIXTURE_CLIENT.email,
        adminId,
      ],
    );
    console.log(
      `[${label}] Created E2E fixture client: "${LOCAL_FIXTURE_CLIENT.companyName}"`,
    );
  }

  const existingJob = await client.query(
    "SELECT id FROM jobs WHERE title = $1 AND deleted_at IS NULL LIMIT 1",
    [LOCAL_FIXTURE_JOB.title],
  );

  if (existingJob.rowCount && existingJob.rowCount > 0) {
    const existingJobId = existingJob.rows[0].id;
    // Re-assert the fields the e2e suite depends on: status MUST be
    // open (otherwise pickAnyJob's caller may operate on a closed
    // job), the job MUST be linked to the fixture client (so
    // requireAnyClient and requireAnyJob agree on which row is the
    // baseline), and job_type / contract_type stay aligned with the
    // values the suite uses for createTestJob.
    await client.query(
      `UPDATE jobs
          SET status = $2,
              job_type = $3,
              contract_type = $4,
              client_id = $5,
              created_by = $6
        WHERE id = $1`,
      [
        existingJobId,
        LOCAL_FIXTURE_JOB.status,
        LOCAL_FIXTURE_JOB.jobType,
        LOCAL_FIXTURE_JOB.contractType,
        clientRowId,
        adminId,
      ],
    );
    console.log(
      `[${label}] E2E fixture job already exists, re-asserted canonical fields: "${LOCAL_FIXTURE_JOB.title}" (status=${LOCAL_FIXTURE_JOB.status})`,
    );
    return;
  }

  await client.query(
    `INSERT INTO jobs
       (id, title, status, job_type, contract_type, client_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      crypto.randomUUID(),
      LOCAL_FIXTURE_JOB.title,
      LOCAL_FIXTURE_JOB.status,
      LOCAL_FIXTURE_JOB.jobType,
      LOCAL_FIXTURE_JOB.contractType,
      clientRowId,
      adminId,
    ],
  );
  console.log(
    `[${label}] Created E2E fixture job: "${LOCAL_FIXTURE_JOB.title}" (status=${LOCAL_FIXTURE_JOB.status})`,
  );
}

async function seedTarget(target, users, { pauseMs = PRODUCTION_PAUSE_MS } = {}) {
  const connectionString = process.env[target.envVar];

  if (!connectionString) {
    throw new Error(
      `${target.envVar} must be set to seed the ${target.label} database.`,
    );
  }

  console.log(`\n[${target.label}] Target database env var: ${target.envVar}`);
  console.log(`[${target.label}] About to upsert these users:`);
  for (const user of users) {
    console.log(`  - ${user.email} (${user.role}, "${user.fullName}")`);
  }

  if (target.label === "PRODUCTION" && pauseMs > 0) {
    console.log(
      `[${target.label}] Pausing ${pauseMs}ms before writing — Ctrl-C now to abort.`,
    );
    await sleep(pauseMs);
  }

  console.log(`[${target.label}] Connecting…`);
  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const user of users) {
      const existing = await client.query(
        "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1",
        [user.email],
      );

      if (existing.rowCount && existing.rowCount > 0) {
        console.log(`[${target.label}] User already exists: ${user.email}`);
        continue;
      }

      const passwordHash = await bcrypt.hash(user.password, SALT_ROUNDS);

      // The `users.id` column has no database-level default (the schema uses
      // Drizzle's `$defaultFn` which only runs inside the ORM), so generate a
      // UUID here for raw SQL inserts.
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          crypto.randomUUID(),
          user.email,
          passwordHash,
          user.fullName,
          user.role,
        ],
      );

      console.log(
        `[${target.label}] Created user: ${user.email} (${user.role})`,
      );
    }

    if (target.seedsLocalFixtures) {
      console.log(`[${target.label}] Seeding baseline E2E fixtures…`);
      await seedLocalFixtures(client, target.label);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const { db } = parseArgs(process.argv.slice(2));
  const target = TARGETS[db];
  const identities = [
    ...SEED_USER_IDENTITIES,
    ...(target.extraIdentities ?? []),
  ];
  const users = resolveSeedUsers(process.env, identities);
  await seedTarget(target, users);
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  main().catch((error) => {
    console.error("Failed to seed users:", error.message ?? error);
    process.exitCode = 1;
  });
}
