import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./GlobalSearch.tsx", import.meta.url), "utf8")

test("GlobalSearch clears stale results and ignores stale responses during new searches", () => {
  assert.match(source, /const searchRequestSeq = useRef\(0\)/)
  assert.match(source, /setLoading\(true\)[\s\S]*setResponse\(null\)/)
  assert.match(source, /searchRequestSeq\.current !== requestSeq/)
})
