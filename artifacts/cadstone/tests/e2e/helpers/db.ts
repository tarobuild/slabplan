import { Client } from "pg"
import crypto from "node:crypto"

/**
 * Direct PostgreSQL helper for the Playwright e2e suite.
 *
 * The orphan-cleanup spec needs to inject a `files` row whose
 * `file_url` points at a non-existent storage object so the listing
 * endpoint annotates it as `storageStatus: "missing"` and the UI
 * renders the amber "Original file unavailable" tile. Going through
 * the upload API would actually write an object to GCS, defeating the
 * point — so we skip the API and INSERT straight into Postgres.
 *
 * The connection string follows the same default the API server uses
 * for the local DB (artifacts/api-server/package.json `pretest`):
 * postgres://cadstone:cadstone@127.0.0.1:5432/cadstone — overridable
 * via DATABASE_URL or E2E_DATABASE_URL so a Replit/CI run can point at
 * a different host without touching this file.
 */
function databaseUrl(): string {
  return (
    process.env.E2E_DATABASE_URL ??
    process.env.SUPABASE_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone"
  )
}

async function withClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: databaseUrl() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/**
 * Build a `/uploads/...` path that is guaranteed not to exist in the
 * GCS bucket. The leading segment intentionally namespaces these
 * orphan rows so a human poking at storage knows they were synthetic.
 */
export function buildOrphanFileUrl(extension = "txt"): string {
  return `/uploads/__e2e_orphans__/${crypto.randomUUID()}.${extension}`
}

export interface InsertOrphanFileParams {
  folderId: string
  uploadedBy: string
  /** Defaults to a unique `e2e-orphan-<ts>.<ext>` name. */
  originalName?: string
  /** Defaults to `text/plain`. */
  mimeType?: string
  /** Bytes; defaults to 42 so the UI shows a non-empty size. */
  fileSize?: number
}

export interface InsertedOrphanFile {
  id: string
  fileUrl: string
  filename: string
  originalName: string
}

/**
 * Insert a `files` row whose `file_url` points at an object that does
 * not exist in storage. The listing endpoint will annotate the row as
 * `storageStatus: "missing"` and the UI will render the amber tile.
 */
export async function insertOrphanFile(
  params: InsertOrphanFileParams,
): Promise<InsertedOrphanFile> {
  const id = crypto.randomUUID()
  const ext = (params.mimeType ?? "text/plain").includes("pdf") ? "pdf" : "txt"
  const filename =
    params.originalName ?? `e2e-orphan-${Date.now()}-${id.slice(0, 8)}.${ext}`
  const fileUrl = buildOrphanFileUrl(ext)
  const fileSize = params.fileSize ?? 42
  const mimeType = params.mimeType ?? "text/plain"

  return withClient(async (client) => {
    await client.query(
      `INSERT INTO files
         (id, folder_id, filename, original_name, file_url,
          file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7)`,
      [id, params.folderId, filename, fileUrl, fileSize, mimeType, params.uploadedBy],
    )
    return { id, fileUrl, filename, originalName: filename }
  })
}

export interface InsertedLeadOrphanAttachment {
  fileId: string
  attachmentId: string
  folderId: string
  originalName: string
  fileUrl: string
}

/**
 * Mirror the production "lead attachment upload" path far enough to
 * surface a missing-storage tile in the lead sheet:
 *  1. Find or create the lead-scoped attachment folder (matches
 *     `ensureLeadAttachmentFolder` in artifacts/api-server/src/routes/leads.ts).
 *  2. Insert a `files` row pointing at a fake storage URL.
 *  3. Insert a `lead_attachments` row binding the file to the lead.
 *
 * Returns the IDs so the test can hit the UI delete button and then
 * verify both rows are gone via {@link leadAttachmentExists}.
 */
export async function insertOrphanLeadAttachment(params: {
  leadId: string
  uploadedBy: string
}): Promise<InsertedLeadOrphanAttachment> {
  return withClient(async (client) => {
    const folderTitle = `Lead ${params.leadId} Attachments`
    const existingFolder = await client.query<{ id: string }>(
      `SELECT id FROM folders
       WHERE scope = 'lead'
         AND lead_id = $1
         AND job_id IS NULL
         AND title = $2
         AND media_type = 'document'
         AND deleted_at IS NULL
       LIMIT 1`,
      [params.leadId, folderTitle],
    )

    let folderId: string
    if (existingFolder.rowCount && existingFolder.rowCount > 0) {
      folderId = existingFolder.rows[0].id
    } else {
      const createdFolder = await client.query<{ id: string }>(
        `INSERT INTO folders
           (id, title, scope, job_id, lead_id, media_type,
            viewing_permissions, uploading_permissions)
         VALUES ($1, $2, 'lead', NULL, $3, 'document', $4::json, $5::json)
         RETURNING id`,
        [
          crypto.randomUUID(),
          folderTitle,
          params.leadId,
          JSON.stringify({ internal: true }),
          JSON.stringify({ admin: true, project_manager: true }),
        ],
      )
      folderId = createdFolder.rows[0].id
    }

    const fileId = crypto.randomUUID()
    const filename = `e2e-lead-orphan-${Date.now()}-${fileId.slice(0, 8)}.txt`
    const fileUrl = buildOrphanFileUrl("txt")
    await client.query(
      `INSERT INTO files
         (id, folder_id, filename, original_name, file_url,
          file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $3, $4, 42, 'text/plain', $5)`,
      [fileId, folderId, filename, fileUrl, params.uploadedBy],
    )

    const attachmentId = crypto.randomUUID()
    await client.query(
      `INSERT INTO lead_attachments (id, lead_id, file_id) VALUES ($1, $2, $3)`,
      [attachmentId, params.leadId, fileId],
    )

    return {
      fileId,
      attachmentId,
      folderId,
      originalName: filename,
      fileUrl,
    }
  })
}

/** Check whether a `files` row currently exists (ignoring soft delete). */
export async function fileRowExists(fileId: string): Promise<boolean> {
  return withClient(async (client) => {
    const r = await client.query(`SELECT 1 FROM files WHERE id = $1 LIMIT 1`, [
      fileId,
    ])
    return (r.rowCount ?? 0) > 0
  })
}

/** Check whether a `lead_attachments` row currently exists. */
export async function leadAttachmentExists(
  attachmentId: string,
): Promise<boolean> {
  return withClient(async (client) => {
    const r = await client.query(
      `SELECT 1 FROM lead_attachments WHERE id = $1 LIMIT 1`,
      [attachmentId],
    )
    return (r.rowCount ?? 0) > 0
  })
}

/** Best-effort cleanup helpers used in afterEach to keep the DB tidy. */
export async function deleteFileRow(fileId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`DELETE FROM files WHERE id = $1`, [fileId])
  })
}

export async function deleteLeadRow(leadId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`DELETE FROM leads WHERE id = $1`, [leadId])
  })
}
