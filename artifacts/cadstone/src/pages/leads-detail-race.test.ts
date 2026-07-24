import assert from "node:assert/strict"
import { describe, test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(import.meta.dirname, "leads.tsx")

describe("lead detail sheet request ordering", () => {
  test("openSheet ignores stale detail responses", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(
      source,
      /const activeSheetLeadIdRef = useRef<string \| null>\(null\)/,
      "lead detail sheet must track the active lead id outside async state",
    )
    assert.match(
      source,
      /const detailRequestSeqRef = useRef\(0\)/,
      "lead detail sheet must sequence detail requests",
    )
    assert.match(
      source,
      /const requestId = \+\+detailRequestSeqRef\.current[\s\S]{0,120}activeSheetLeadIdRef\.current = leadId/,
      "opening a lead must mark the current request and active lead",
    )
    assert.match(
      source,
      /requestId !== detailRequestSeqRef\.current \|\|[\s\S]{0,120}activeSheetLeadIdRef\.current !== leadId/,
      "stale detail responses must no-op instead of overwriting the active sheet",
    )
    assert.match(
      source,
      /detailRequestSeqRef\.current \+= 1[\s\S]{0,120}activeSheetLeadIdRef\.current = null[\s\S]{0,120}setSheetLeadId\(null\)/,
      "closing the sheet must invalidate pending detail requests",
    )
  })
})
