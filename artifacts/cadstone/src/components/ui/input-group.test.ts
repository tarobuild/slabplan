import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./input-group.tsx", import.meta.url), "utf8")

test("InputGroupAddon focuses the declared input-group control", () => {
  assert.match(source, /\[data-slot='input-group-control'\]/)
  assert.doesNotMatch(source, /querySelector<[^>]+>\(\s*"input"/)
})
