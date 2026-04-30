import bcrypt from "bcrypt";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const r = await pool.query("select password_hash from users where email='task123-test@cadstone.test'");
console.log("hash:", r.rows[0].password_hash);
console.log("match:", await bcrypt.compare("Cadstone123!", r.rows[0].password_hash));
await pool.end();
