import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(here, "users.tsx")

test("users invite banner prefers API inviteUrl over rebuilding from invitePath", async () => {
  const source = await readFile(sourcePath, "utf8")

  assert.match(
    source,
    /function resolveInviteLink\(invite: Pick<InviteResponse, "invitePath" \| "inviteUrl">\): string \{[\s\S]*?return invite\.inviteUrl\?\.trim\(\) \|\| buildAbsoluteInviteLink\(invite\.invitePath\)/,
  )
  assert.match(
    source,
    /const latestInviteLink = latestInvite \? resolveInviteLink\(latestInvite\) : ""/,
  )
  assert.match(source, /value=\{latestInviteLink\}/)
  assert.match(source, /onClick=\{\(\) => copyToClipboard\(latestInviteLink\)\}/)
})
