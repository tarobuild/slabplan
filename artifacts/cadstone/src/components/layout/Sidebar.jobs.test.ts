import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "Sidebar.tsx")
const source = readFileSync(sourcePath, "utf8")

describe("Sidebar job loading", () => {
  it("guards job load state changes to the latest request", () => {
    assert.match(source, /const jobLoadSeqRef = useRef\(0\)/)
    assert.match(source, /const requestSeq = \+\+jobLoadSeqRef\.current/)
    assert.match(source, /loadAllSidebarJobs\(\)\s+\.then\(\(r\) => \{\s+if \(requestSeq !== jobLoadSeqRef\.current\) return\s+setJobs\(r\)/s)
    assert.match(source, /catch\(\(err: unknown\) => \{\s+if \(requestSeq !== jobLoadSeqRef\.current\) return/s)
  })

  it("loads every paginated jobs page for navigation search", () => {
    assert.match(source, /const SIDEBAR_JOBS_PAGE_SIZE = 200/)
    assert.match(source, /async function loadAllSidebarJobs\(\)/)
    assert.match(source, /let page = 1/)
    assert.match(source, /\/jobs\?pageSize=\$\{SIDEBAR_JOBS_PAGE_SIZE\}&page=\$\{page\}/)
    assert.match(source, /allJobs\.push\(\.\.\.pageJobs\)/)
    assert.match(source, /const totalPages = data\.pagination\?\.totalPages/)
    assert.match(source, /else if \(!data\.pagination\?\.hasMore\) \{\s+break\s+\}/s)
    assert.match(source, /page \+= 1/)
    assert.doesNotMatch(source, /api\s*\.\s*get\("\/jobs\?pageSize=200"\)/)
  })
})
