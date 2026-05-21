import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "clients.tsx")
const source = readFileSync(sourcePath, "utf8")

describe("ClientsPage detail loading", () => {
  it("ignores stale client detail responses and stale failures", () => {
    const openDetailSource = source.slice(
      source.indexOf("const openDetail = async"),
      source.indexOf("const handleCreate"),
    )

    assert.match(source, /const detailRequestSeqRef = useRef\(0\)/)
    assert.match(openDetailSource, /const requestSeq = \+\+detailRequestSeqRef\.current/)
    assert.match(openDetailSource, /if \(detailRequestSeqRef\.current !== requestSeq\) return\s+setSelected/s)
    assert.match(openDetailSource, /catch \(err: unknown\) \{\s+if \(detailRequestSeqRef\.current !== requestSeq\) return/s)
    assert.match(openDetailSource, /if \(searchParams\.get\("client"\) === id\)/)
    assert.match(openDetailSource, /if \(detailRequestSeqRef\.current === requestSeq\) \{\s+setLoadingDetail\(false\)/s)
  })
})
