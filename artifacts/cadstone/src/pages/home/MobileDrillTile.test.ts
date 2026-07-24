import assert from "node:assert/strict"
import { test } from "node:test"

import {
  loadActiveJobs,
  loadAllDrillPages,
  loadOpenLeads,
  loadOpenScheduleItems,
} from "./MobileDrillTile.tsx"

type Call = {
  url: string
  params: Record<string, unknown>
}

test("loadAllDrillPages follows cursor pagination until the final page", async () => {
  const calls: Call[] = []
  const pages = [
    { jobs: [{ id: "job-1" }], pagination: { hasMore: true, nextCursor: "cursor-2" } },
    { jobs: [{ id: "job-2" }], pagination: { hasMore: false, nextCursor: null } },
  ]

  const items = await loadAllDrillPages<{ id: string }>(
    "/jobs",
    { status: "open" },
    (data) => (data as { jobs: Array<{ id: string }> }).jobs,
    async (url, config) => {
      calls.push({ url, params: config.params })
      return { data: pages[calls.length - 1] }
    },
  )

  assert.deepEqual(items.map((item) => item.id), ["job-1", "job-2"])
  assert.deepEqual(calls, [
    { url: "/jobs", params: { status: "open", cursor: "", limit: 100 } },
    { url: "/jobs", params: { status: "open", cursor: "cursor-2", limit: 100 } },
  ])
})

test("loadAllDrillPages fails loudly when a continuing page has no next cursor", async () => {
  await assert.rejects(
    () =>
      loadAllDrillPages(
        "/jobs",
        {},
        () => [],
        async () => ({ data: { jobs: [], pagination: { hasMore: true, nextCursor: null } } }),
      ),
    /missing nextCursor/,
  )
})

test("active jobs drill uses server-side status and cursor pagination", async () => {
  const calls: Call[] = []

  await loadActiveJobs(async (url, config) => {
    calls.push({ url, params: config.params })
    return { data: { jobs: [], pagination: { hasMore: false, nextCursor: null } } }
  })

  assert.deepEqual(calls, [
    { url: "/jobs", params: { status: "open", cursor: "", limit: 100 } },
  ])
})

test("open leads drill fetches every open status with cursor pagination", async () => {
  const calls: Call[] = []

  const leads = await loadOpenLeads(async (url, config) => {
    calls.push({ url, params: config.params })
    const status = String(config.params.status)
    const cursor = String(config.params.cursor)
    if (status === "open" && cursor === "") {
      return {
        data: {
          leads: [{ id: "lead-2", title: "Beta", status }],
          pagination: { hasMore: true, nextCursor: "open-2" },
        },
      }
    }
    return {
      data: {
        leads: [{ id: `${status}-${cursor || "first"}`, title: status, status }],
        pagination: { hasMore: false, nextCursor: null },
      },
    }
  })

  assert.equal(calls.every((call) => call.url === "/leads"), true)
  assert.equal(calls.every((call) => call.params.limit === 100), true)
  assert.deepEqual(
    Array.from(new Set(calls.map((call) => call.params.status))).sort(),
    ["in_negotiation", "open", "qualified"],
  )
  assert.deepEqual(
    calls.filter((call) => call.params.status === "open").map((call) => call.params.cursor),
    ["", "open-2"],
  )
  assert.deepEqual(
    leads.map((lead) => lead.title),
    ["Beta", "in_negotiation", "open", "qualified"],
  )
})

test("open schedule drill fetches all incomplete status buckets with cursor pagination", async () => {
  const calls: Call[] = []

  const items = await loadOpenScheduleItems(async (url, config) => {
    calls.push({ url, params: config.params })
    const status = String(config.params.status)
    return {
      data: {
        data: [
          {
            id: status,
            title: status,
            startDate: status === "overdue" ? "2025-01-01" : "2025-01-02",
            endDate: null,
            isComplete: false,
            jobId: `job-${status}`,
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      },
    }
  })

  assert.equal(calls.every((call) => call.url === "/schedule"), true)
  assert.equal(calls.every((call) => call.params.limit === 100), true)
  assert.deepEqual(
    Array.from(new Set(calls.map((call) => call.params.status))).sort(),
    ["in_progress", "overdue", "upcoming"],
  )
  assert.deepEqual(
    items.map((item) => item.id),
    ["overdue", "in_progress", "upcoming"],
  )
})
