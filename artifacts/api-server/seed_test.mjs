import bcrypt from "bcrypt";
import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const testPassword = process.env.SEED_TEST_PASSWORD;
if (!testPassword) {
  console.error("Set SEED_TEST_PASSWORD before running this local seed helper.");
  process.exit(1);
}
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const hash = await bcrypt.hash(testPassword, 10);
  const u = await client.query(
    `insert into users (email, password_hash, full_name, role) values ($1,$2,$3,$4)
     on conflict (email) do update set password_hash=excluded.password_hash returning id`,
    ["task123-test@cadstone.test", hash, "Task 123 Tester", "admin"]
  );
  const userId = u.rows[0].id;
  console.log("user id:", userId);
  // Make sure we have a job
  const jr = await client.query("select id from jobs where deleted_at is null limit 1");
  let jobId;
  if (jr.rowCount === 0) {
    const j = await client.query(
      `insert into jobs (title, status, created_by) values ($1,$2,$3) returning id`,
      ["Test Job for Task 123", "active", userId]
    );
    jobId = j.rows[0].id;
  } else {
    jobId = jr.rows[0].id;
  }
  console.log("job id:", jobId);
  // Insert 5 daily logs across 3 distinct dates
  const logs = [
    ["2026-04-29", "Log A1", "first note"],
    ["2026-04-29", "Log A2", "second note"],
    ["2026-04-28", "Log B1", "third note"],
    ["2026-04-27", "Log C1", "fourth note"],
    ["2026-04-26", "Log D1", "fifth note"],
  ];
  for (const [d, t, n] of logs) {
    await client.query(
      `insert into daily_logs (job_id, log_date, title, notes, created_by) values ($1,$2,$3,$4,$5)`,
      [jobId, d, t, n, userId]
    );
  }
  await client.query("COMMIT");
  console.log("seed ok");
} catch (e) {
  await client.query("ROLLBACK");
  console.error("error:", e.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
