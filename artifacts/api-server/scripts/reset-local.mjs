import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `pg` is only declared as a dependency of @workspace/db, so resolve it
// through lib/db's own node_modules instead of the api-server's.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(
  path.resolve(__dirname, "../../../lib/db/package.json"),
);
const { Client } = dbRequire("pg");

// Wipe every application table in the LOCAL dev database only.
// This intentionally uses DATABASE_URL and ignores SUPABASE_DATABASE_URL so
// running this script can never touch the production Supabase database.
const TRUNCATE_SQL = `
  TRUNCATE TABLE
    daily_log_attachments, daily_log_comments, daily_log_custom_fields,
    daily_log_likes, daily_log_tags, daily_log_todos, daily_logs,
    schedule_item_assignees, schedule_item_attachments, schedule_item_notes,
    schedule_item_predecessors, schedule_item_todos, schedule_items,
    schedule_phases, schedule_baselines, schedule_settings,
    schedule_tag_settings, schedule_workday_exception_categories,
    schedule_workday_exceptions,
    lead_attachments, lead_contacts, lead_salespeople, lead_sources,
    lead_tags, leads,
    files, folders,
    client_contacts, clients,
    activity_log,
    jobs,
    users
  CASCADE
`;

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL must be set. This script targets the LOCAL dev database only.",
    );
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    console.log("Truncating all application tables in LOCAL database…");
    await client.query(TRUNCATE_SQL);
    console.log("Local database truncated.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to reset local database:", error);
  process.exitCode = 1;
});
