import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const source = readFileSync(new URL("./ChatPanel.tsx", import.meta.url), "utf8")

test("agent composer blocks sends while usage state is unknown or failed", () => {
  assert.match(source, /const \[usageLoading, setUsageLoading\] = useState\(false\)/)
  assert.match(source, /const \[usageError, setUsageError\] = useState<string \| null>\(null\)/)
  assert.match(source, /if \(usageLoading \|\| usageError \|\| !usage\) \{/)
  assert.match(source, /Assistant usage is unavailable\. Reload usage before sending\./)
  assert.match(source, /const usageUnavailable = usageLoading \|\| Boolean\(usageError\) \|\| !usage/)
  assert.match(source, /disabled=\{composerDisabled \|\| !draft\.trim\(\)\}/)
})

test("agent usage load failures are surfaced with retry instead of ignored", () => {
  assert.doesNotMatch(source, /catch \{\s*\/\* ignore \*\/\s*\}/)
  assert.match(source, /setUsageError\(agentErrorMessage\(err, "Assistant usage could not be loaded\."\)\)/)
  assert.match(source, /Usage unavailable\./)
  assert.match(source, /onClick=\{\(\) => void refreshUsage\(\)\}/)
})
