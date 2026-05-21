import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "pagination.tsx")
const source = readFileSync(sourcePath, "utf8")

describe("PaginationEllipsis accessibility", () => {
  it("exposes the More pages label while hiding only the decorative icon", () => {
    const ellipsisSource = source.slice(
      source.indexOf("const PaginationEllipsis"),
      source.indexOf("PaginationEllipsis.displayName"),
    )

    assert.match(ellipsisSource, /<span className="sr-only">More pages<\/span>/)
    assert.match(ellipsisSource, /<MoreHorizontal className="h-4 w-4" aria-hidden="true" \/>/)
    assert.doesNotMatch(ellipsisSource, /<span\s+[^>]*aria-hidden="true"/)
  })
})
