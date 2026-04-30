import { pool } from "../index";

const INDEX_NAME = "files_folder_created_id_idx";
const TABLE_NAME = "public.files";
const CREATE_SQL = `create index concurrently if not exists ${INDEX_NAME}
  on ${TABLE_NAME} (folder_id, created_at desc, id desc)`;
const DROP_SQL = `drop index concurrently if exists public.${INDEX_NAME}`;

type IndexStatus = {
  exists: boolean;
  valid: boolean;
  ready: boolean;
};

async function getIndexStatus(): Promise<IndexStatus> {
  const result = await pool.query<{ indisvalid: boolean; indisready: boolean }>(
    `
      select i.indisvalid, i.indisready
      from pg_class c
      join pg_index i on i.indexrelid = c.oid
      join pg_namespace n on n.oid = c.relnamespace
      where c.relname = $1
        and n.nspname = 'public'
        and c.relkind = 'i'
    `,
    [INDEX_NAME],
  );

  if (result.rowCount === 0) {
    return { exists: false, valid: false, ready: false };
  }

  const row = result.rows[0];
  return { exists: true, valid: row.indisvalid, ready: row.indisready };
}

async function main() {
  // CREATE/DROP INDEX CONCURRENTLY cannot run inside a transaction. The
  // node-postgres pool defaults to autocommit, so we issue these directly
  // without wrapping them in BEGIN/COMMIT.

  const initial = await getIndexStatus();

  if (initial.exists && initial.valid) {
    console.log(
      `[ok] Index ${INDEX_NAME} already exists and is valid. Nothing to do.`,
    );
    return;
  }

  if (initial.exists && !initial.valid) {
    console.log(
      `[warn] Index ${INDEX_NAME} exists but is INVALID (likely a prior ` +
        `CREATE INDEX CONCURRENTLY was interrupted). Dropping it concurrently ` +
        `before rebuilding.`,
    );
    await pool.query(DROP_SQL);
    console.log(`[ok] Dropped invalid ${INDEX_NAME}.`);
  }

  console.log(
    `[info] Building ${INDEX_NAME} on ${TABLE_NAME} concurrently. This does ` +
      `not block writes but may take a while on large tables...`,
  );
  const startedAt = Date.now();
  await pool.query(CREATE_SQL);
  const elapsedMs = Date.now() - startedAt;
  console.log(`[ok] CREATE INDEX CONCURRENTLY finished in ${elapsedMs}ms.`);

  const final = await getIndexStatus();
  if (!final.exists) {
    throw new Error(
      `Index ${INDEX_NAME} is missing after build. Inspect the database manually.`,
    );
  }
  if (!final.valid) {
    throw new Error(
      `Index ${INDEX_NAME} was created but is INVALID. Re-run this script to ` +
        `drop and rebuild it.`,
    );
  }

  console.log(`[ok] Index ${INDEX_NAME} is present and valid.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
