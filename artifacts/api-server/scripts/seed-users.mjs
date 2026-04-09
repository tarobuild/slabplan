import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";

// `pg` is only declared as a dependency of @workspace/db, so resolve it
// through lib/db's own node_modules instead of the api-server's.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(
  path.resolve(__dirname, "../../../lib/db/package.json"),
);
const { Client } = dbRequire("pg");

const SALT_ROUNDS = 10;

const SEED_USERS = [
  {
    fullName: "Cesar",
    email: "cesar@cadstone.works",
    password: "Test1!",
    role: "admin",
  },
  {
    fullName: "Anwar",
    email: "anwar@cadstone.works",
    password: "Test2!",
    role: "admin",
  },
];

const TARGETS = {
  local: {
    label: "LOCAL",
    envVar: "DATABASE_URL",
  },
  production: {
    label: "PRODUCTION",
    envVar: "SUPABASE_DATABASE_URL",
  },
};

function parseDbFlag(argv) {
  for (const arg of argv) {
    if (arg === "--db=local") return "local";
    if (arg === "--db=production") return "production";
    if (arg.startsWith("--db=")) {
      throw new Error(
        `Unknown --db value: ${arg}. Expected --db=local or --db=production.`,
      );
    }
  }
  return null;
}

async function seedTarget(target) {
  const connectionString = process.env[target.envVar];

  if (!connectionString) {
    throw new Error(
      `${target.envVar} must be set to seed the ${target.label} database.`,
    );
  }

  console.log(`\n[${target.label}] Seeding users (${target.envVar})…`);
  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const user of SEED_USERS) {
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
  const selected = parseDbFlag(process.argv.slice(2));
  const targetKeys = selected ? [selected] : ["local", "production"];

  for (const key of targetKeys) {
    await seedTarget(TARGETS[key]);
  }
}

main().catch((error) => {
  console.error("Failed to seed users:", error);
  process.exitCode = 1;
});
