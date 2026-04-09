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

async function main() {
  const connectionString =
    process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "SUPABASE_DATABASE_URL (or DATABASE_URL) must be set to seed users.",
    );
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const user of SEED_USERS) {
      const existing = await client.query(
        "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1",
        [user.email],
      );

      if (existing.rowCount && existing.rowCount > 0) {
        console.log(`User already exists: ${user.email}`);
        continue;
      }

      const passwordHash = await bcrypt.hash(user.password, SALT_ROUNDS);

      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)`,
        [user.email, passwordHash, user.fullName, user.role],
      );

      console.log(`Created user: ${user.email} (${user.role})`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to seed users:", error);
  process.exitCode = 1;
});
