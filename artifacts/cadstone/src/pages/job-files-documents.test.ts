import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./job-files-documents.tsx", import.meta.url), "utf8")

test("job documents page derives file tab links from the route jobId", () => {
  assert.match(source, /const \{ jobId \} = useParams<\{ jobId: string \}>\(\)/)
  assert.match(source, /\{ label: "Documents", path: "files\/documents" \}/)
  assert.match(source, /\{ label: "Photos", path: "files\/photos" \}/)
  assert.match(source, /\{ label: "Videos", path: "files\/videos" \}/)
  assert.match(source, /to=\{`\/jobs\/\$\{jobId\}\/\$\{tab\.path\}`\}/)
})

test("job documents page marks Documents active and configures FileBrowser", () => {
  assert.match(source, /tab\.path === "files\/documents"/)
  assert.match(source, /bg-white border border-b-white border-\[#E5E7EB\] text-slate-900 -mb-px/)
  assert.match(source, /<FileBrowser mediaType="document" defaultView="list" \/>/)
})
