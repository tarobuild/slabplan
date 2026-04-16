import { expect, test } from "@playwright/test"
import { CESAR, authHeaders, loginViaApi } from "./helpers/auth"
import { pickAnyJob } from "./helpers/api"
import { CESAR_STATE } from "./helpers/storage"

test.use({ storageState: CESAR_STATE })

/**
 * Smoke test for the FileBrowser upload pipeline. We create and delete
 * the file via the API so the test doesn't depend on the drag-and-drop
 * overlay (which is genuinely hard to drive from Playwright), but we do
 * assert that the uploaded file shows up in the UI listing.
 */
test.describe("file upload", () => {
  let token = ""
  let jobId = ""
  let uploadedFileId: string | null = null
  const fileName = `e2e-upload-${Date.now()}.txt`

  test.beforeAll(async ({ request }) => {
    token = (await loginViaApi(request, CESAR)).accessToken
    const job = await pickAnyJob(request, token)
    test.skip(!job, "Need at least one job Cesar can see")
    jobId = job!.id
  })

  test.afterAll(async ({ request }) => {
    if (uploadedFileId) {
      await request.delete(`/api/files/${uploadedFileId}`, {
        headers: authHeaders(token),
      })
    }
  })

  test("uploaded document appears in the job's documents FileBrowser", async ({
    page,
    request,
  }) => {
    const foldersRes = await request.get(
      `/api/jobs/${jobId}/folders?mediaType=document`,
      { headers: authHeaders(token) },
    )
    expect(foldersRes.ok()).toBeTruthy()
    const folders = (await foldersRes.json()).folders ?? []
    test.skip(folders.length === 0, "No documents folder for this job")
    const folder = folders[0]
    const folderId = folder.id as string
    const folderTitle = folder.title as string

    const uploadRes = await request.post(`/api/folders/${folderId}/files`, {
      headers: authHeaders(token),
      multipart: {
        files: {
          name: fileName,
          mimeType: "text/plain",
          buffer: Buffer.from("hello from playwright\n"),
        },
      },
    })
    expect(
      uploadRes.ok(),
      `upload failed: ${uploadRes.status()} ${await uploadRes.text()}`,
    ).toBeTruthy()
    const uploadBody = await uploadRes.json()
    const uploaded = (uploadBody.files ?? uploadBody)[0] ?? uploadBody
    uploadedFileId = uploaded.id ?? uploadBody.id ?? null

    // The FileBrowser root view shows only folders — files aren't
    // listed until the folder is opened. Click into the folder and
    // then assert the uploaded file is visible.
    await page.goto(`/jobs/${jobId}/files/documents`)
    // The FolderCard stacks an invisible "Open <title>" button on top
    // of the card to capture clicks; target that button directly.
    await page
      .getByRole("button", { name: new RegExp(`Open ${folderTitle}`, "i") })
      .first()
      .click()
    await expect(page.getByText(fileName).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
