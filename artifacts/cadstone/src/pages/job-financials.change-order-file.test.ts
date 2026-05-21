import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./job-financials.tsx", import.meta.url), "utf8")

test("parsed change-order source file is not captured in the save draft", () => {
  const draftType = source.slice(
    source.indexOf("const [coDraft, setCoDraft]"),
    source.indexOf("const [coSaving, setCoSaving]"),
  )
  const setDraft = source.slice(
    source.indexOf("setCoDraft({"),
    source.indexOf("})", source.indexOf("setCoDraft({")),
  )
  const savePayload = source.slice(
    source.indexOf("await api.post(`/jobs/${jobId}/financials/change-orders`"),
    source.indexOf("setCoDraft(null)", source.indexOf("await api.post(`/jobs/${jobId}/financials/change-orders`")),
  )

  assert.doesNotMatch(draftType, /fileId/)
  assert.doesNotMatch(setDraft, /fileId/)
  assert.doesNotMatch(savePayload, /fileId/)
  assert.match(source, /uploaded document remains in the Financials folder/)
})
