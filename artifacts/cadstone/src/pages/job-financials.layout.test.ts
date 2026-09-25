import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./job-financials.tsx", import.meta.url), "utf8")
const changes = source.slice(source.indexOf("{/* Change orders */}"), source.indexOf("{/* Invoices */}"))

test("change orders have one authoritative list with summary and approval actions", () => {
  assert.equal((source.match(/data\.changeOrders\.map\(/g) ?? []).length, 1)
  assert.match(changes, /status === "approved"/)
  assert.match(changes, /status === "pending"/)
  assert.match(changes, /changeOrderApprovedCents/)
  assert.match(changes, /canManage \? \(/)
  assert.match(changes, /setChangeOrderStatus\(co\.id, "approved"\)/)
  assert.match(changes, /setChangeOrderStatus\(co\.id, "rejected"\)/)
  assert.match(changes, /ref=\{coInputRef\}/)
})

test("financial controls wrap and wide change-order rows scroll within their section", () => {
  assert.match(changes, /CardHeader className="[^"]*flex-wrap[^"]*gap-3/)
  assert.match(changes, /CardContent className="overflow-x-auto"/)
  assert.match(changes, /table aria-label="Change orders" className="[^"]*min-w-\[680px\]/)
  assert.match(changes, /sr-only">Actions/)
})
