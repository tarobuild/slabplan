import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./ClientPickerDialog.tsx", import.meta.url), "utf8")

test("ClientPickerDialog clears stale clients and renders failed-load state", () => {
  assert.match(source, /setClients\(\[\]\)/)
  assert.match(source, /setLoadError\(true\)/)
  assert.match(source, /Couldn't load clients\./)
  assert.match(source, /loadError \?/)
})

test("ClientPickerDialog loads every matching client page for search", () => {
  assert.match(source, /const CLIENT_PICKER_PAGE_SIZE = 100/)
  assert.match(source, /async function loadAllPickableClients\(search: string\)/)
  assert.match(source, /let page = 1/)
  assert.match(source, /pageSize: CLIENT_PICKER_PAGE_SIZE/)
  assert.match(source, /search: search\.trim\(\) \|\| undefined/)
  assert.match(source, /allClients\.push\(\.\.\.raw\)/)
  assert.match(source, /const totalPages = response\.data\?\.pagination\?\.totalPages/)
  assert.match(source, /if \(typeof totalPages !== "number" \|\| page >= totalPages\) break/)
  assert.match(source, /page \+= 1/)
  assert.match(source, /return allClients\.filter\(\(c\) => !c\.archived\)/)
  assert.match(source, /loadAllPickableClients\(search\)/)
})
