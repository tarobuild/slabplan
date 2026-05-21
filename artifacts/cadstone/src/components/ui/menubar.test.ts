import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./menubar.tsx", import.meta.url), "utf8")

test("MenubarContent includes both open and closed animation triggers", () => {
  const contentBlock = source.slice(
    source.indexOf("const MenubarContent ="),
    source.indexOf("MenubarContent.displayName"),
  )

  assert.match(contentBlock, /data-\[state=open\]:animate-in/)
  assert.match(contentBlock, /data-\[state=closed\]:animate-out/)
  assert.match(contentBlock, /data-\[state=closed\]:fade-out-0/)
  assert.match(contentBlock, /data-\[state=open\]:fade-in-0/)
})
