import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

test("menu content max-height classes use valid CSS var() syntax", async () => {
  const contextMenu = await readFile(new URL("./context-menu.tsx", import.meta.url), "utf8")
  const dropdownMenu = await readFile(new URL("./dropdown-menu.tsx", import.meta.url), "utf8")

  assert.match(contextMenu, /max-h-\[var\(--radix-context-menu-content-available-height\)\]/)
  assert.match(dropdownMenu, /max-h-\[var\(--radix-dropdown-menu-content-available-height\)\]/)
  assert.doesNotMatch(contextMenu, /max-h-\[--radix-context-menu-content-available-height\]/)
  assert.doesNotMatch(dropdownMenu, /max-h-\[--radix-dropdown-menu-content-available-height\]/)
})
