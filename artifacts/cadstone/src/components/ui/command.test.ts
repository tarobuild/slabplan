import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "command.tsx")
const source = readFileSync(sourcePath, "utf8")

describe("CommandEmpty", () => {
  it("merges caller className with default empty-state styles", () => {
    const emptySource = source.slice(
      source.indexOf("const CommandEmpty"),
      source.indexOf("CommandEmpty.displayName"),
    )

    assert.match(emptySource, /\(\{ className, \.\.\.props \}, ref\)/)
    assert.match(emptySource, /className=\{cn\("py-6 text-center text-sm", className\)\}/)
    assert.doesNotMatch(emptySource, /className="py-6 text-center text-sm"/)
  })
})
