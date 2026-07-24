import assert from "node:assert/strict"
import { describe, test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(import.meta.dirname, "my-daily-logs.tsx")

describe("MyDailyLogsPage URL filters", () => {
  test("client filter is derived from React Router search params and reloads logs", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(
      source,
      /import \{ Link, useSearchParams \} from "react-router-dom"/,
      "client filter must use React Router search params so client-side URL changes re-render the page",
    )
    assert.match(
      source,
      /const \[searchParams\] = useSearchParams\(\)/,
      "page must read query params from React Router state",
    )
    assert.match(
      source,
      /const clientFilterParam = searchParams\.get\("client"\)/,
      "client filter must be derived from the current search params",
    )
    assert.match(
      source,
      /\}, \[debouncedSearch, clientFilterId\]\)/,
      "initial log load effect must depend on clientFilterId",
    )
  })
})
