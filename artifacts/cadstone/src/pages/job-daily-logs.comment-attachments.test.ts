import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./job-daily-logs.tsx", import.meta.url), "utf8")

test("comment draft attachment previews are revoked on close, submit, remove, and unmount", () => {
  assert.match(source, /export function revokeCommentDraftAttachmentPreviews/)
  assert.match(source, /URL\.revokeObjectURL\(item\.previewUrl\)/)
  assert.match(source, /const attachmentsRef = useRef<CommentDraftAttachment\[\]>\(\[\]\)/)
  assert.match(source, /attachmentsRef\.current = attachments/)

  assert.match(source, /if \(!open\) \{\s+revokeCommentDraftAttachmentPreviews\(attachmentsRef\.current\)\s+attachmentsRef\.current = \[\]/s)
  assert.match(source, /return \(\) => \{\s+revokeCommentDraftAttachmentPreviews\(attachmentsRef\.current\)\s+attachmentsRef\.current = \[\]\s+\}/s)
  assert.match(source, /revokeCommentDraftAttachmentPreviews\(attachments\)\s+attachmentsRef\.current = \[\]\s+setAttachments\(\[\]\)/s)
  assert.match(source, /if \(target\) URL\.revokeObjectURL\(target\.previewUrl\)/)
})

test("comment draft attachment ref is synchronized when attachments are added or removed", () => {
  assert.match(source, /const updated = \[\.\.\.current, \.\.\.next\]\s+attachmentsRef\.current = updated\s+return updated/s)
  assert.match(source, /const updated = current\.filter\(\(item\) => item\.fileId !== targetId\)\s+attachmentsRef\.current = updated\s+return updated/s)
})
