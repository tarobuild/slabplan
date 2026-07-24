import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "ChatPanel.tsx")
const source = readFileSync(sourcePath, "utf8")

describe("ChatPanel conversation loading", () => {
  it("does not treat failed conversation loads as empty history", () => {
    assert.match(source, /throw err/)
    assert.doesNotMatch(source, /catch[^{]*\{[^}]*return \[\]/s)
  })

  it("does not auto-create a conversation after list failures", () => {
    const failureGuardIndex = source.indexOf("} catch {")
    const createIndex = source.indexOf(
      "const created = await createConversation()",
      failureGuardIndex,
    )

    assert.notEqual(failureGuardIndex, -1)
    assert.notEqual(createIndex, -1)
    assert.ok(failureGuardIndex < createIndex)
    assert.match(
      source.slice(failureGuardIndex, createIndex),
      /catch \{\s+return\s+\}/,
    )
  })
})
