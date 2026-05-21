import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./daily-logs.tsx", import.meta.url), "utf8")

test("daily logs only treat true boolean query filters as active", () => {
  assert.match(
    source,
    /\(key === "hasAttachments" \|\| key === "hasComments"\) && v !== "true"/,
  )
})
