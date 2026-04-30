/**
 * seed-users.mjs — upsert the CAD Stone admin users into a database, plus
 * a synthetic crew_member fixture for the Playwright e2e suite when
 * seeding the local database.
 *
 * Usage:
 *   SEED_ADMIN_CESAR_PASSWORD=... SEED_ADMIN_ANWAR_PASSWORD=... \
 *     SEED_WORKER_FIXTURE_PASSWORD=... \
 *     node artifacts/api-server/scripts/seed-users.mjs --db=local
 *
 *   SEED_ADMIN_CESAR_PASSWORD=... SEED_ADMIN_ANWAR_PASSWORD=... \
 *     node artifacts/api-server/scripts/seed-users.mjs \
 *     --db=production --i-know-what-im-doing
 *
 * Required arguments:
 *   --db=local        seed the local database (uses DATABASE_URL)
 *   --db=production   seed the live database (uses SUPABASE_DATABASE_URL)
 *                     and ALSO requires --i-know-what-im-doing.
 *
 * Required env vars (admins, both targets):
 *   SEED_ADMIN_CESAR_PASSWORD   password for cesar@cadstone.works
 *   SEED_ADMIN_ANWAR_PASSWORD   password for anwar@cadstone.works
 *
 * Required env vars (local only — worker fixture):
 *   SEED_WORKER_FIXTURE_PASSWORD  password for worker@cadstone.works
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

// Admin identities. Cesar and Anwar are real admins on the team; they
// invite workers through the in-app flow. Passwords are intentionally
// NOT in this file — they come from environment variables at runtime.
// See file header for usage.
export const SEED_USER_IDENTITIES = [
  {
    fullName: "Cesar",
    email: "cesar@cadstone.works",
    role: "admin",
    passwordEnvVar: "SEED_ADMIN_CESAR_PASSWORD",
  },
  {
    fullName: "Anwar",
    email: "anwar@cadstone.works",
    role: "admin",
    passwordEnvVar: "SEED_ADMIN_ANWAR_PASSWORD",
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
  email: "worker@cadstone.works",
  role: "crew_member",
  passwordEnvVar: "SEED_WORKER_FIXTURE_PASSWORD",
};

export const TARGETS = {
  local: {
    label: "LOCAL",
    envVar: "DATABASE_URL",
    // Local also seeds the worker fixture so the Playwright suite can
    // exercise role-gated paths against a true crew_member user.
    extraIdentities: [WORKER_FIXTURE_IDENTITY],
  },
  production: {
    label: "PRODUCTION",
    envVar: "SUPABASE_DATABASE_URL",
    extraIdentities: [],
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
  "cadstone",
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
