import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const source = readFileSync(new URL("./ClientPickerDialog.tsx", import.meta.url), "utf8")

test("client picker sends search and pagination to the clients endpoint", () => {
  assert.match(source, /api\.get\("\/clients", \{/)
  assert.match(source, /page:\s*nextPage/)
  assert.match(source, /pageSize:\s*CLIENT_PAGE_SIZE/)
  assert.match(source, /status:\s*"all"/)
  assert.match(source, /search:\s*query \|\| undefined/)
  assert.match(source, /pagination\?\.hasMore/)
  assert.match(source, /loadClients\(page \+ 1, "append"\)/)
})

test("client picker no longer filters only the first local client page", () => {
  assert.doesNotMatch(source, /const filtered = useMemo/)
  assert.doesNotMatch(source, /\.filter\(\(client\) =>\s*\[/)
})
