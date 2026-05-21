import assert from "node:assert/strict"
import test from "node:test"
import { completionStateForProgress } from "./schedule-progress.ts"

test("completionStateForProgress reopens completed items below 100 percent", () => {
  assert.deepEqual(completionStateForProgress(50), {
    progress: 50,
    isComplete: false,
  })
})

test("completionStateForProgress completes items at 100 percent", () => {
  assert.deepEqual(completionStateForProgress(100), {
    progress: 100,
    isComplete: true,
  })
})
