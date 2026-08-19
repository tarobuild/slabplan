import assert from "node:assert/strict"
import { describe, test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(import.meta.dirname, "job-daily-logs.tsx")

describe("daily log save validation", () => {
  test("save returns before mutation when payload validation fails", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.doesNotMatch(
      source,
      /validatePayload\([^)]*\)\s*\?\?\s*payload/,
      "persist must not fall back to the raw payload after schema validation fails",
    )
    assert.match(
      source,
      /const validatedPayload = validatePayload\(DailyLogsPutDailyLogsIdBody, payload\)\s*if \(!validatedPayload\) return[\s\S]{0,220}updateLogMutation\.mutateAsync\(\{[\s\S]{0,140}data: validatedPayload as DailyLogsPutDailyLogsIdMutationBody/,
      "update mutation must only receive the validated payload",
    )
    assert.match(
      source,
      /const validatedPayload = validatePayload\(DailyLogsPostJobsJobIdDailyLogsBody, payload\)\s*if \(!validatedPayload\) return[\s\S]{0,220}createLogMutation\.mutateAsync\(\{[\s\S]{0,140}data: validatedPayload as DailyLogsPostJobsJobIdDailyLogsMutationBody/,
      "create mutation must only receive the validated payload",
    )
  })

  test("background settings refreshes cannot reset an open daily log draft", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(
      source,
      /const initializationSessionRef = useRef<string \| null>\(null\)/,
      "the dialog must track which open session it initialized",
    )
    assert.match(
      source,
      /if \(!open\) \{\s*initializationSessionRef\.current = null\s*return\s*\}[\s\S]{0,180}const sessionKey = `\$\{logId \?\? "new"\}:\$\{jobId\}`[\s\S]{0,180}if \(initializationSessionRef\.current === sessionKey\) return[\s\S]{0,100}initializationSessionRef\.current = sessionKey/,
      "the dialog must initialize once per open log/job session",
    )
  })
})
