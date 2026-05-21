import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./WorkerAssignmentPicker.tsx", import.meta.url), "utf8")

test("WorkerAssignmentPicker keeps list open while focus stays inside", () => {
  assert.match(source, /event\.currentTarget\.contains\(nextTarget\)/)
  assert.doesNotMatch(source, /setTimeout\(\(\) => setFocused\(false\), 150\)/)
})
