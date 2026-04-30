import bcrypt from "bcrypt";
import pg from "pg";
import crypto from "node:crypto";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const hash = await bcrypt.hash("Cadstone123!", 10);
  const userId = crypto.randomUUID();
  await client.query(
    `insert into users (id, email, password_hash, full_name, role) values ($1,$2,$3,$4,$5)
     on conflict (email) do update set password_hash=excluded.password_hash returning id`,
    [userId, "task123-test@cadstone.test", hash, "Task 123 Tester", "admin"]
  );
  const finalUser = await client.query("select id from users where email=$1", ["task123-test@cadstone.test"]);
  const uid = finalUser.rows[0].id;
  console.log("user id:", uid);
  // Job
  const jr = await client.query("select id from jobs where deleted_at is null limit 1");
  let jobId;
  if (jr.rowCount === 0) {
    jobId = crypto.randomUUID();
    await client.query(
      `insert into jobs (id, title, status, created_by) values ($1,$2,$3,$4)`,
      [jobId, "Test Job for Task 123", "active", uid]
    );
  } else {
    jobId = jr.rows[0].id;
  }
  console.log("job id:", jobId);
  // Clean up any prior runs for this user
  await client.query("delete from daily_logs where created_by=$1", [uid]);
  // Insert 5 daily logs
  const logs = [
    ["2026-04-29", "Log A1", "first note"],
    ["2026-04-29", "Log A2", "second note"],
    ["2026-04-28", "Log B1", "third note"],
    ["2026-04-27", "Log C1", "fourth note"],
    ["2026-04-26", "Log D1", "fifth note"],
  ];
  for (const [d, t, n] of logs) {
    await client.query(
      `insert into daily_logs (id, job_id, log_date, title, notes, created_by) values ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), jobId, d, t, n, uid]
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
