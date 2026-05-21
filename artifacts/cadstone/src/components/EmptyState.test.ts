import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./EmptyState.tsx", import.meta.url), "utf8")

test("EmptyState href actions render through Link instead of plain buttons", () => {
  assert.match(source, /asChild=\{Boolean\(item\.href\)\}/)
  assert.match(source, /<Link to=\{item\.href\}>\{item\.label\}<\/Link>/)
})
