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

test("financial summary reserves room for monetary values without narrow desktop cards", () => {
  const summary = source.slice(source.indexOf('aria-label="Financial summary"'), source.indexOf("{/* Overall % billed bar */}"))
  assert.match(summary, /min-\[360px\]:grid-cols-2/)
  assert.match(summary, /lg:grid-cols-4/)
  assert.match(summary, /min-\[1800px\]:grid-cols-8/)
  assert.match(summary, /<dt /)
  assert.match(summary, /<dd className="mt-1 break-words text-lg font-semibold tabular-nums"/)
  assert.doesNotMatch(summary, /<Card|xl:text-xl|xl:grid-cols-8/)
})
