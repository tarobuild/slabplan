import assert from "node:assert/strict"
import { test } from "node:test"

import { unsavedGuardLocationKey } from "./use-unsaved-changes.tsx"

test("unsaved changes guard location key includes query and hash", () => {
  assert.notEqual(
    unsavedGuardLocationKey({ pathname: "/leads", search: "?lead=a", hash: "" }),
    unsavedGuardLocationKey({ pathname: "/leads", search: "?lead=b", hash: "" }),
  )
  assert.notEqual(
    unsavedGuardLocationKey({ pathname: "/leads", search: "", hash: "#edit" }),
    unsavedGuardLocationKey({ pathname: "/leads", search: "", hash: "#details" }),
  )
  assert.equal(
    unsavedGuardLocationKey({ pathname: "/leads", search: "?lead=a", hash: "#edit" }),
    "/leads?lead=a#edit",
  )
})
