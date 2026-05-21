import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./context-menu.tsx", import.meta.url), "utf8")

test("ContextMenuContent uses a valid Radix available-height CSS variable", () => {
  assert.match(source, /max-h-\[var\(--radix-context-menu-content-available-height\)\]/)
  assert.doesNotMatch(source, /max-h-\[--radix-context-menu-content-available-height\]/)
})
