import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "toast.tsx")
const source = readFileSync(sourcePath, "utf8")

describe("ToastClose accessibility", () => {
  it("provides a default accessible close label and hides the icon", () => {
    const closeSource = source.slice(
      source.indexOf("const ToastClose"),
      source.indexOf("ToastClose.displayName"),
    )

    assert.match(closeSource, /"aria-label": ariaLabel = "Close"/)
    assert.match(closeSource, /aria-label=\{ariaLabel\}/)
    assert.match(closeSource, /<X className="h-4 w-4" aria-hidden="true" \/>/)
  })
})
