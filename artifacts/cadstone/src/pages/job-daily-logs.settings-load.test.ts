import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./job-daily-logs.tsx", import.meta.url), "utf8")

test("daily log settings cannot be opened or saved until loaded", () => {
  assert.match(source, /const \[settingsLoaded, setSettingsLoaded\] = useState\(false\)/)
  assert.match(source, /const \[settingsLoadError, setSettingsLoadError\] = useState<string \| null>\(null\)/)
  assert.match(source, /setSettingsLoaded\(true\)/)
  assert.match(source, /setSettingsLoaded\(false\)/)
  assert.match(source, /toastApiError\(settingsResult\.reason, "Failed to load daily log settings"\)/)
  assert.match(source, /if \(!settingsLoaded\) \{\s+toast\.error\(settingsLoadError \?\? "Daily log settings are still loading"\)\s+return\s+\}/s)
  assert.match(source, /function handleOpenSettings\(\) \{\s+if \(!settingsLoaded\)/s)
  assert.match(source, /onClick=\{handleOpenSettings\}/)
  assert.match(source, /disabled=\{!settingsLoaded\}/)
})
