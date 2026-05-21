import assert from "node:assert/strict"
import test from "node:test"
import { loadAllDrillPages } from "./MobileDrillTile.pagination.ts"

test("loadAllDrillPages reads every numbered page", async () => {
  const requestedPages: number[] = []

  const items = await loadAllDrillPages(async (page) => {
    requestedPages.push(page)
    return {
      items: [`page-${page}`],
      pagination: { page, totalPages: 3 },
    }
  })

  assert.deepEqual(requestedPages, [1, 2, 3])
  assert.deepEqual(items, ["page-1", "page-2", "page-3"])
})

test("loadAllDrillPages supports hasMore pagination", async () => {
  const items = await loadAllDrillPages(async (page) => ({
    items: [page],
    pagination: { page, hasMore: page < 2 },
  }))

  assert.deepEqual(items, [1, 2])
})
