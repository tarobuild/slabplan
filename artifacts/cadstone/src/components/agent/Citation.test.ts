import assert from "node:assert/strict"
import test from "node:test"
import type { AgentCitation } from "@/lib/agent-api"
import { hrefFor } from "./Citation.tsx"

function citation(overrides: Partial<AgentCitation>): AgentCitation {
  return {
    kind: "lead",
    id: "id-1",
    label: "Citation",
    ...overrides,
  }
}

test("hrefFor encodes query-string citation identifiers", () => {
  assert.equal(
    hrefFor(citation({ kind: "lead", id: "abc&client=victim" })),
    "/sales/leads?lead=abc%26client%3Dvictim",
  )
})

test("hrefFor encodes path and query citation identifiers", () => {
  assert.equal(
    hrefFor(
      citation({
        kind: "file",
        id: "file/with?chars",
        jobId: "job/with?chars",
      }),
    ),
    "/jobs/job%2Fwith%3Fchars/files/documents?file=file%2Fwith%3Fchars",
  )
})
