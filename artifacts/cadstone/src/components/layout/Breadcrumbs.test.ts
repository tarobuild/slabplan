import assert from "node:assert/strict"
import test from "node:test"
import { deriveFromPath } from "./Breadcrumbs.tsx"

test("deriveFromPath does not duplicate the static Home crumb for dashboard paths", () => {
  assert.deepEqual(
    deriveFromPath("/dashboard/jobs").map((item) => item.label),
    ["Jobs"],
  )
})
