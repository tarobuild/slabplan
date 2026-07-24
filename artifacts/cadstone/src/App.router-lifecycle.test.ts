import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { test } from "node:test"

const sourcePath = path.resolve(import.meta.dirname, "App.tsx")

test("App keeps the browser router stable across auth readiness changes", async () => {
  const source = await fs.readFile(sourcePath, "utf8")

  assert.match(
    source,
    /const AuthReadyContext = createContext\(false\)/,
    "auth readiness should be delivered through React context",
  )
  assert.match(
    source,
    /const router = useMemo\(\(\) => buildRouter\(basename\), \[basename\]\)/,
    "router construction must depend only on basename",
  )
  assert.doesNotMatch(
    source,
    /buildRouter\(ready/,
    "auth readiness must not force a replacement browser router",
  )
  assert.doesNotMatch(
    source,
    /useMemo\(\(\) => buildRouter\([^)]*\), \[[^\]]*ready/,
    "auth readiness must not be a router memo dependency",
  )
})
