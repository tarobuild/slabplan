import assert from "node:assert/strict"
import { test } from "node:test"

import { isNewerReleaseAvailable } from "./app-release"

test("release update detection only fires when both releases are known and different", () => {
  assert.equal(isNewerReleaseAvailable("a13d0e67f13a", "a13d0e67f13a"), false)
  assert.equal(isNewerReleaseAvailable("a13d0e67f13a", "bc198b94abcd"), true)
  assert.equal(isNewerReleaseAvailable("", "bc198b94abcd"), false)
  assert.equal(isNewerReleaseAvailable("a13d0e67f13a", null), false)
  assert.equal(isNewerReleaseAvailable("a13d0e67f13a", undefined), false)
})
