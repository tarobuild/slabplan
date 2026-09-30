import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./index.tsx", import.meta.url), "utf8")

test("reports navigation pads its scroller so focus rings and the selected pill are not clipped", () => {
  assert.match(source, /aria-label="Reports"/)
  assert.match(source, /className="[^"]*overflow-x-auto p-1\.5[^"]*"/)
  assert.match(source, /focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2/)
})

test("reports layout does not nest a second main landmark inside the app shell", () => {
  assert.doesNotMatch(source, /<main\b/)
})
