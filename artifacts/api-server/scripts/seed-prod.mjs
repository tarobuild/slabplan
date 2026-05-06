import bcrypt from 'bcrypt';
import pg from 'pg';
import crypto from 'node:crypto';

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) throw new Error('SUPABASE_DATABASE_URL is not set');

const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function pw() {
  const buf = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += charset[buf[i] % charset.length];
  return out;
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const u = new URL(url);
console.log(`Connected: host=${u.hostname} db=${u.pathname.slice(1)}\n`);

const existing = await client.query(
  `SELECT id, email, full_name, role, is_active FROM users ORDER BY created_at`
);
console.log('=== EXISTING USERS IN PRODUCTION ===');
for (const r of existing.rows) {
  console.log(`  ${r.email}  role=${r.role}  active=${r.is_active}  name="${r.full_name}"  id=${r.id}`);
}

// Decide who Cesar / Anwar are. Heuristic: match by name OR email containing the name.
function findFor(name) {
  const needle = name.toLowerCase();
  return existing.rows.find(
    (r) =>
      (r.full_name || '').toLowerCase().includes(needle) ||
      (r.email || '').toLowerCase().includes(needle),
  );
}

const cesar = findFor('cesar');
const anwar = findFor('anwar');

const targets = [];
if (cesar) targets.push({ user: cesar, password: 'Cs-' + pw(), label: 'Cesar' });
else targets.push({ insertEmail: 'cesar@cadstonesystems.com', name: 'Cesar Cadstone', password: 'Cs-' + pw(), label: 'Cesar' });
if (anwar) targets.push({ user: anwar, password: 'An-' + pw(), label: 'Anwar' });
else targets.push({ insertEmail: 'anwar@cadstonesystems.com', name: 'Anwar Cadstone', password: 'An-' + pw(), label: 'Anwar' });

console.log('\n=== ACTIONS ===');
for (const t of targets) {
  const hash = await bcrypt.hash(t.password, 10);
  if (t.user) {
    await client.query(
      `UPDATE users SET password_hash=$1, role='admin', is_active=true,
       password_set_at=now(), updated_at=now(), deleted_at=NULL WHERE id=$2`,
      [hash, t.user.id]
    );
    console.log(`  UPDATED ${t.label}: ${t.user.email} (id=${t.user.id}) → admin, password reset`);
    t.email = t.user.email;
  } else {
    const r = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active, password_set_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'admin', true, now(), now(), now()) RETURNING id, email`,
      [t.insertEmail, hash, t.name]
    );
    console.log(`  INSERTED ${t.label}: ${r.rows[0].email} (id=${r.rows[0].id})`);
    t.email = r.rows[0].email;
  }
}

await client.end();

console.log('\n=== LOGIN CREDENTIALS — share with each person ===');
console.log('=== Login URL: https://cadstonesystems.com   (or https://cadstone-works-tool.replit.app) ===\n');
for (const t of targets) {
  console.log(`  ${t.label}:`);
  console.log(`    email:    ${t.email}`);
  console.log(`    password: ${t.password}\n`);
}
