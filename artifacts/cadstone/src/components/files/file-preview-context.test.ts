import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./file-preview-context.tsx", import.meta.url), "utf8")

test("FilePreviewProvider normalizes the requested preview index before storing state", () => {
  assert.match(source, /const normalizedIndex = Math\.min\(Math\.max\(index, 0\), files\.length - 1\)/)
  assert.match(source, /setState\(\{ files, index: normalizedIndex \}\)/)
  assert.doesNotMatch(source, /setState\(\{ files, index \}\)/)
})
