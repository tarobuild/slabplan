import { expect, test } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { requireAnyJob } from "./helpers/api"
import {
  deleteFileRow,
  deleteLeadRow,
  fileRowExists,
  insertOrphanFile,
  insertOrphanLeadAttachment,
  leadAttachmentExists,
} from "./helpers/db"
import { CESAR_STATE } from "./helpers/storage"

test.use({ storageState: CESAR_STATE })

/**
 * Regression coverage for the "Original file unavailable" tile and the
 * admin "Remove orphan row" cleanup action.
 *
 * The unavailable-tile + purge flow was previously only verified by
 * typechecking and code review. This spec inserts a `files` row whose
 * `file_url` points at a non-existent storage object (so the listing
 * endpoint annotates `storageStatus: "missing"`), drives the FileBrowser
 * UI as an admin, and asserts:
 *   - The amber unavailable tile renders with disabled preview/download
 *     (no Open / Download menu items, no row-level Download button).
 *   - Triggering the menu's "Remove orphan row" item hits
 *     `DELETE /files/:id/purge`, the row physically leaves the DB, and
 *     the listing endpoint stops returning it.
 *
 * A second test repeats the coverage for the lead attachments surface
 * (different rendering path, different DELETE endpoint) so a future
 * change to either flow can't silently revert the behaviour.
 */
test.describe("orphan file cleanup", () => {
  let token = ""
  let userId = ""

  test.beforeAll(async ({ request }) => {
    const session = await loginViaApi(request, CESAR)
    token = session.accessToken
    userId = session.userId
  })

  test("file browser shows unavailable tile and lets admin purge it", async ({
    page,
    request,
  }) => {
    const job = await requireAnyJob(request, token)

    // Pick a real document folder. Reading the listing auto-seeds the
    // "Global Documents" system folder if the job is fresh, matching
    // the file-upload spec's setup.
    const foldersRes = await request.get(
      `/api/jobs/${job.id}/folders?mediaType=document`,
      { headers: authHeaders(token) },
    )
    expect(
      foldersRes.ok(),
      `folders fetch failed: ${foldersRes.status()}`,
    ).toBeTruthy()
    const folders = (await foldersRes.json()).folders ?? []
    expect(
      folders.length,
      "expected at least one document folder (Global Documents is auto-seeded)",
    ).toBeGreaterThan(0)
    const folder = folders[0]
    const folderId = folder.id as string
    const folderTitle = folder.title as string

    const orphan = await insertOrphanFile({
      folderId,
      uploadedBy: userId,
    })

    let purgeResponseStatus: number | null = null

    try {
      // Confirm the listing endpoint already classifies the row as
      // missing — if probeStorageStatus fails open and returns "ok"
      // we'd otherwise see the regular file row instead of the tile.
      const listingBeforeRes = await request.get(
        `/api/folders/${folderId}/files?page=1&limit=100`,
        { headers: authHeaders(token) },
      )
      expect(listingBeforeRes.ok()).toBeTruthy()
      const listingBefore = await listingBeforeRes.json()
      const orphanRow = (listingBefore.files ?? []).find(
        (f: { id: string }) => f.id === orphan.id,
      )
      expect(orphanRow, "inserted orphan row should appear in listing").toBeTruthy()
      expect(
        orphanRow.storageStatus,
        "listing endpoint should mark fake-URL row as missing",
      ).toBe("missing")

      await page.goto(`/jobs/${job.id}/files/documents`)
      await page
        .getByRole("button", { name: new RegExp(`Open ${folderTitle}`, "i") })
        .first()
        .click()

      // Find the orphan's table row.
      const row = page.locator("tr", { hasText: orphan.originalName })
      await expect(row).toBeVisible({ timeout: 15_000 })
      await expect(
        row.getByText(/Original file unavailable/i),
      ).toBeVisible()

      // Preview is disabled: the row should NOT have the orange
      // filename link (which is only rendered when storageStatus is
      // "ok"). The filename text exists, but only as a strikethrough
      // span — assert no <button> inside the row carries the filename.
      await expect(
        row.locator(`button:has-text("${orphan.originalName}")`),
      ).toHaveCount(0)
      // Row-level download icon-button is also suppressed for orphans.
      await expect(
        row.locator(`button[aria-label^="Download "]`),
      ).toHaveCount(0)

      // Capture the purge call so we can assert success after the UI
      // confirms removal. Match by URL so we don't lock in the method
      // capitalisation.
      const purgePromise = page.waitForResponse((res) => {
        if (!res.url().includes(`/files/${orphan.id}/purge`)) return false
        purgeResponseStatus = res.status()
        return true
      })

      await row
        .getByRole("button", { name: `Actions for ${orphan.originalName}` })
        .click()

      // Open / Download must be hidden for missing files; only "Remove
      // orphan row" should be available to an admin.
      await expect(
        page.getByRole("menuitem", { name: /^Open$/ }),
      ).toHaveCount(0)
      await expect(
        page.getByRole("menuitem", { name: /^Download$/ }),
      ).toHaveCount(0)
      const removeItem = page.getByRole("menuitem", { name: /Remove orphan row/i })
      await expect(removeItem).toBeVisible()
      await removeItem.click()

      // Confirm the alert dialog. The orphan-specific copy reads
      // "Remove permanently"; assert the dialog title too so we know
      // the missing-file branch rendered.
      await expect(
        page.getByRole("alertdialog").getByText(/Remove this orphan file row/i),
      ).toBeVisible()
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: /Remove permanently/i })
        .click()

      const purgeResponse = await purgePromise
      expect(purgeResponse.status()).toBe(200)
      expect(purgeResponseStatus).toBe(200)

      // Row vanishes from the UI.
      await expect(row).toHaveCount(0, { timeout: 10_000 })

      // Backend confirms the row is gone (purge is a hard delete).
      expect(await fileRowExists(orphan.id)).toBe(false)
      const listingAfterRes = await request.get(
        `/api/folders/${folderId}/files?page=1&limit=100`,
        { headers: authHeaders(token) },
      )
      expect(listingAfterRes.ok()).toBeTruthy()
      const listingAfter = await listingAfterRes.json()
      expect(
        (listingAfter.files ?? []).some(
          (f: { id: string }) => f.id === orphan.id,
        ),
        "orphan row should no longer appear in listing after purge",
      ).toBe(false)
    } finally {
      // Defensive cleanup: if the UI flow above bailed before purging,
      // delete the row so we don't leak a broken tile across runs.
      if (await fileRowExists(orphan.id)) {
        await deleteFileRow(orphan.id)
      }
    }
  })

  test("lead attachment row shows unavailable tile and lets admin remove it", async ({
    page,
    request,
  }) => {
    // Create a brand-new lead so the test is isolated from any
    // operator-managed fixture lead (and so cleanup is trivially safe).
    const leadRes = await request.post("/api/leads", {
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      data: {
        title: `E2E Orphan Lead ${Date.now()}`,
        status: "open",
      },
    })
    expect(
      leadRes.ok(),
      `lead create failed: ${leadRes.status()} ${await leadRes.text()}`,
    ).toBeTruthy()
    const leadBody = await leadRes.json()
    const leadId: string = leadBody.lead?.id ?? leadBody.id

    const orphan = await insertOrphanLeadAttachment({
      leadId,
      uploadedBy: userId,
    })

    try {
      // Lead-detail endpoint should classify the attachment as missing.
      const detailBeforeRes = await request.get(`/api/leads/${leadId}`, {
        headers: authHeaders(token),
      })
      expect(detailBeforeRes.ok()).toBeTruthy()
      const detailBefore = await detailBeforeRes.json()
      const att = (detailBefore.lead?.attachments ?? []).find(
        (a: { id: string }) => a.id === orphan.attachmentId,
      )
      expect(att, "lead-detail should include the inserted attachment").toBeTruthy()
      expect(att.storageStatus).toBe("missing")

      // Deep-link straight into the lead sheet via ?lead=<id>.
      await page.goto(`/sales/leads?lead=${leadId}`)

      const sheet = page.getByRole("dialog")
      await expect(sheet).toBeVisible({ timeout: 15_000 })

      // The attachment row renders with the amber unavailable label.
      // Scope the assertion to the sheet so we don't accidentally
      // match other surfaces on the page.
      const attachmentRow = sheet
        .locator("div", { hasText: orphan.originalName })
        .filter({ hasText: /Original file unavailable/i })
        .first()
      await expect(attachmentRow).toBeVisible({ timeout: 10_000 })

      // Filename must NOT be rendered as the preview-opening button —
      // missing files should be inert. Asserting count=0 across the
      // whole sheet keeps the check tight to the rendering branch.
      await expect(
        sheet.locator(`button:has-text("${orphan.originalName}")`),
      ).toHaveCount(0)

      // Click the orphan-specific delete button (its aria-label is
      // distinct from the regular "Delete attachment" copy so we
      // assert the missing-file branch rendered).
      const deleteButton = sheet.getByRole("button", {
        name: /Permanently remove orphan attachment/i,
      })
      await expect(deleteButton).toBeVisible()

      const deletePromise = page.waitForResponse(
        (res) =>
          res.request().method() === "DELETE" &&
          res
            .url()
            .includes(
              `/api/leads/${leadId}/attachments/${orphan.attachmentId}`,
            ),
      )

      await deleteButton.click()

      // Confirm dialog (shared lead-attachment alert).
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: /^Delete$/ })
        .click()

      const deleteResponse = await deletePromise
      expect(deleteResponse.status()).toBe(200)

      // The attachment row should disappear and the underlying file +
      // attachment rows must both be gone (the lead delete endpoint
      // hard-deletes both).
      await expect(attachmentRow).toHaveCount(0, { timeout: 10_000 })
      expect(await leadAttachmentExists(orphan.attachmentId)).toBe(false)
      expect(await fileRowExists(orphan.fileId)).toBe(false)
    } finally {
      if (await fileRowExists(orphan.fileId)) {
        await deleteFileRow(orphan.fileId)
      }
      // Purge the synthetic lead. Cascade takes care of any remaining
      // lead-scoped folder/attachment rows.
      await deleteLeadRow(leadId)
    }
  })
})
