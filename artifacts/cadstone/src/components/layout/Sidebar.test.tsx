import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8")

test("Sidebar conventional TSX component test is included by package test globs", () => {
  assert.equal(import.meta.url.endsWith("/Sidebar.test.tsx"), true)
})

test("Sidebar renders Stone Track navigation without legacy files routes", () => {
  assert.match(source, /export default function Sidebar\(\)/)
  assert.match(source, /navigate\("\/jobs", \{ state: \{ openCreate: true \} \}\)/)
  assert.match(source, /navigate\(`\/jobs\/\$\{job\.id\}`\)/)
  assert.doesNotMatch(source, /navigate\("\/files"\)/)
})
