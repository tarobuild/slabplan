import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

test("job summary stacks full-width panels below the desktop breakpoint", () => {
  const source = readFileSync(new URL("./job-summary.tsx", import.meta.url), "utf8")
  assert.match(source, /flex flex-col items-start gap-5 xl:flex-row/)
  assert.match(source, /w-full min-w-0 space-y-5 xl:flex-1/)
  assert.match(source, /w-full shrink-0 space-y-5 xl:w-72/)
  assert.ok(source.includes("disabled={!canEditJob}"))
  assert.ok(source.includes("{unsavedChanges.dialog}"))
})
