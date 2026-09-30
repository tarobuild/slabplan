import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./users.tsx", import.meta.url), "utf8")

test("team members render as stacked rows on phones and a table from md up", () => {
  const phone = source.slice(source.indexOf('aria-label="Team members"'), source.indexOf("</ul>"))
  assert.match(source, /aria-label="Team members"\s*className="[^"]*md:hidden"/)
  // Every control column is visible on phones without sideways scrolling.
  for (const part of ["member.status", "member.role", "member.setup", "member.actions"]) {
    assert.match(phone, new RegExp(`\\{${part.replace(".", "\\.")}\\}`), part)
  }
  assert.match(source, /className="hidden overflow-hidden rounded-lg border[^"]*md:block"/)
})

test("phone rows and table cells share one set of member controls and handlers", () => {
  assert.equal((source.match(/renderMemberParts\(user\)/g) ?? []).length, 2)
  const parts = source.slice(source.indexOf("const renderMemberParts"), source.indexOf("return { selfTag, role, status, setup, actions }"))
  assert.match(parts, /handleRoleChange\(user, value as AdminUser\["role"\]\)/)
  assert.match(parts, /onClick=\{\(\) => handleReissue\(user\)\}/)
  assert.match(parts, /onClick=\{\(\) => handleToggleActive\(user\)\}/)
  // Guards are unchanged: no self-deactivation, no reissue for inactive users.
  assert.match(parts, /disabled=\{\(isSelf && active\) \|\| pendingPatchId === user\.id\}/)
  assert.match(parts, /disabled=\{reissuingId === user\.id \|\| !active\}/)
  assert.match(parts, /aria-label=\{`Role for \$\{user\.fullName\}`\}/)
  // Each handler is wired exactly once in the source.
  assert.equal((source.match(/handleReissue\(user\)/g) ?? []).length, 1)
  assert.equal((source.match(/handleToggleActive\(user\)/g) ?? []).length, 1)
})
