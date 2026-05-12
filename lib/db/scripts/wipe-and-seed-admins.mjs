#!/usr/bin/env node
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import pg from "pg";

const DATABASE_URL = process.env.SUPABASE_DATABASE_URL;
if (!DATABASE_URL) {
  console.error("SUPABASE_DATABASE_URL is not set.");
  process.exit(1);
}

const PUBLIC_HOST = process.env.APP_PUBLIC_URL?.trim() || "https://cadstonesystems.com";

const ADMINS = [
  { email: "anwar@cadstoneworks.com", fullName: "Anwar" },
  { email: "cesar@cadstoneworks.com", fullName: "Cesar" },
];

const DATA_TABLES = [
  "activity_log",
  "agent_messages",
  "agent_conversations",
  "agent_usage_monthly",
  "invoice_line_payments",
  "tracker_invoices",
  "change_orders",
  "sov_line_items",
  "sov_areas",
  "financial_trackers",
  "schedule_item_predecessors",
  "schedule_item_todos",
  "schedule_item_attachments",
  "schedule_item_notes",
  "schedule_item_assignees",
  "schedule_items",
  "schedule_baselines",
  "schedule_workday_exceptions",
  "schedule_workday_exception_categories",
  "schedule_tag_settings",
  "schedule_settings",
  "schedule_phases",
  "daily_log_todos",
  "daily_log_comments",
  "daily_log_likes",
  "daily_log_attachments",
  "daily_log_tags",
  "daily_logs",
  "daily_log_custom_fields",
  "daily_log_settings",
  "lead_attachments",
  "lead_salespeople",
  "lead_sources",
  "lead_tags",
  "lead_contacts",
  "leads",
  "file_annotations",
  "files",
  "folders",
  "job_assignees",
  "jobs",
  "client_contacts",
  "clients",
  "personal_access_tokens",
  "idempotency_keys",
  "rate_limit_buckets",
  "users",
];

function hashInviteToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generateInvite() {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  const tableList = DATA_TABLES.map((t) => `"${t}"`).join(", ");
  console.log(`Wiping ${DATA_TABLES.length} tables…`);
  await client.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
  console.log("Wipe complete.");

  const results = [];
  for (const admin of ADMINS) {
    const placeholderHash = await bcrypt.hash(
      crypto.randomBytes(32).toString("base64url"),
      10,
    );
    const invite = generateInvite();
    const { rows } = await client.query(
      `INSERT INTO users (
        id, email, full_name, role, password_hash, is_active,
        invite_token_hash, invite_token, invite_token_expires_at,
        password_set_at
      ) VALUES (gen_random_uuid(), $1, $2, 'admin', $3, true, $4, $5, $6, NULL)
      RETURNING id, email, full_name, role`,
      [
        admin.email.toLowerCase(),
        admin.fullName,
        placeholderHash,
        invite.tokenHash,
        invite.token,
        invite.expiresAt,
      ],
    );
    const row = rows[0];
    const inviteUrl = `${PUBLIC_HOST.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(invite.token)}`;
    results.push({ ...row, inviteUrl, expiresAt: invite.expiresAt.toISOString() });
  }

  console.log("\n=================================================");
  console.log("DATABASE WIPED + 2 ADMIN ACCOUNTS CREATED");
  console.log("=================================================\n");
  for (const r of results) {
    console.log(`Name:   ${r.full_name}`);
    console.log(`Email:  ${r.email}`);
    console.log(`Role:   ${r.role}`);
    console.log(`Expires: ${r.expiresAt}`);
    console.log(`Invite link:\n  ${r.inviteUrl}\n`);
  }
} catch (err) {
  console.error("FAILED:", err);
  process.exitCode = 1;
} finally {
  await client.end();
}
