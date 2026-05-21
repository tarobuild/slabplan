import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./CreateJobDialog.tsx", import.meta.url), "utf8")

test("inline client contact failure is visible and does not clear contact fields", () => {
  assert.match(
    source,
    /Client was created, but the primary contact could not be saved\./,
  )
  assert.match(source, /catch \(err: unknown\) \{[\s\S]*toastApiError[\s\S]*return;/)
})

test("client is presented and enforced as required before advancing past step 1", () => {
  assert.match(source, /<Label>\s+Client \*/)
  assert.match(source, /if \(!effectiveClientId\) \{\s+toast\.error\("Pick a client before continuing\."\);?\s+return;?\s+\}/s)
  assert.match(source, /<SelectItem value="_none" disabled>\s+Select a client\s+<\/SelectItem>/)
  assert.doesNotMatch(source, /— None —/)
})

test("job creation still guards against a missing client before submit", () => {
  assert.match(source, /if \(!effectiveClientId\) \{\s+toast\.error\("Pick a client before creating the job\."\);?\s+setStep\(1\);?\s+return;?\s+\}/s)
  assert.match(source, /clientId: effectiveClientId/)
})

test("locked client changes synchronize without wiping other form fields", () => {
  assert.match(
    source,
    /useEffect\(\(\) => \{\s+if \(!open \|\| !lockClient\) return;?\s+setForm\(\(current\) => \(\{ \.\.\.current, clientId: defaultClientId \?\? "" \}\)\);?\s+\}, \[open, lockClient, defaultClientId\]\)/s,
  )
})

test("locked client id is authoritative for advancing and submitting", () => {
  assert.match(
    source,
    /const effectiveClientId = lockClient\s+\? defaultClientId \|\| ""\s+: form\.clientId \|\| "";/,
  )
  assert.match(
    source,
    /<Select\s+value=\{\s+\(lockClient \? defaultClientId : form\.clientId\) \|\| "_none"\s+\}\s+disabled=\{lockClient\}/s,
  )
})
