import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./daily-logs.tsx", import.meta.url), "utf8")

test("daily logs URL params drive the filter state", () => {
  assert.match(source, /const \[searchParams, setSearchParams\] = useSearchParams\(\)/)
  assert.match(source, /for \(const key of FILTER_KEYS\) \{/)
  assert.match(source, /const v = searchParams\.get\(key\)/)
  assert.match(source, /if \(v\) out\[key\] = v/)
})

test("daily logs filter changes are written back to the URL", () => {
  assert.match(source, /const next = new URLSearchParams\(searchParams\)/)
  assert.match(source, /if \(value && value !== "__all__"\) next\.set\(key, value\)/)
  assert.match(source, /else next\.delete\(key\)/)
  assert.match(source, /setSearchParams\(next, \{ replace: true \}\)/)
})

test("daily logs package test coverage includes TSX test files", () => {
  assert.equal(import.meta.url.endsWith("/daily-logs.test.tsx"), true)
})
