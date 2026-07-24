import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const source = readFileSync(new URL("./empty.tsx", import.meta.url), "utf8")

test("Empty default container includes a visible dashed border", () => {
  assert.match(source, /rounded-lg border border-dashed/)
})
