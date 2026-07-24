import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(here, "job-daily-logs.tsx")

test("comment sheet cleanup revokes current draft attachment preview URLs on close and unmount", async () => {
  const source = await readFile(sourcePath, "utf8")

  assert.match(
    source,
    /function revokeCommentDraftAttachmentPreviews\([\s\S]*?items: Array<Pick<CommentDraftAttachment, "previewUrl">>[\s\S]*?\) \{[\s\S]*?URL\.revokeObjectURL\(item\.previewUrl\)/,
  )
  assert.match(source, /const attachmentsRef = useRef<CommentDraftAttachment\[\]>\(\[\]\)/)
  assert.match(source, /attachmentsRef\.current = attachments/)
  assert.match(
    source,
    /if \(!open\) \{[\s\S]*?setSelectedMentionIds\(\[\]\)[\s\S]*?clearDraftAttachments\(\)[\s\S]*?setFormatHint\(false\)/,
  )
  assert.match(
    source,
    /return \(\) => \{[\s\S]*?revokeCommentDraftAttachmentPreviews\(attachmentsRef\.current\)[\s\S]*?attachmentsRef\.current = \[\]/,
  )
})
