import assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

test("convert lead dialog reset effect is keyed by open session and lead id", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const source = await fs.readFile(path.join(here, "ConvertLeadDialog.tsx"), "utf8")

  assert.match(source, /initializedLeadIdRef\s*=\s*useRef<string \| null>\(null\)/)
  assert.match(source, /initializedLeadIdRef\.current === lead\.id/)
  assert.match(source, /\}, \[open, lead\?\.id\]\)/)
  assert.doesNotMatch(
    source,
    /\}, \[open, lead\]\)/,
    "same-id lead object refreshes must not reset in-progress form edits",
  )
})

test("convert lead dialog clears hidden existing-client selection when search changes", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const source = await fs.readFile(path.join(here, "ConvertLeadDialog.tsx"), "utf8")

  assert.match(
    source,
    /function handleClientSearchChange\(value: string\) \{\s*setClientSearch\(value\)\s*setClientId\(""\)\s*\}/,
    "editing the existing-client search must clear any previous selection",
  )
  assert.match(
    source,
    /const selectedClientVisible = visibleClients\.some\(\(client\) => client\.id === clientId\)/,
    "the selected client must remain visible in current results",
  )
  assert.match(
    source,
    /: !!clientId && selectedClientVisible/,
    "Next must stay disabled for hidden stale client selections",
  )
  assert.match(
    source,
    /onChange=\{\(e\) => handleClientSearchChange\(e\.target\.value\)\}/,
    "the search input must use the clearing handler",
  )
})
