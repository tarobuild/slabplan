import assert from "node:assert/strict"
import { describe, test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(import.meta.dirname, "TodosSheet.tsx")

describe("TodosSheet personal to-do completion", () => {
  test("toggle preserves full schedule item payload", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(
      source,
      /import \{ schedulePayloadFromItem \} from "\.\.\/draft"/,
      "TodosSheet must use the shared full schedule payload helper",
    )
    assert.match(
      source,
      /const nextIsComplete = !item\.isComplete[\s\S]{0,180}api\.put\(`\/schedule-items\/\$\{item\.id\}`, \{[\s\S]{0,120}\.\.\.schedulePayloadFromItem\(item\)[\s\S]{0,120}isComplete: nextIsComplete[\s\S]{0,120}progress: nextIsComplete \? 100 : 0/,
      "completion toggle must override only completion fields on the full payload",
    )
    assert.doesNotMatch(
      source,
      /api\.put\(`\/schedule-items\/\$\{item\.id\}`, \{[\s\S]{0,240}title: item\.title[\s\S]{0,240}progress: item\.isComplete \? 0 : 100/,
      "completion toggle must not send the old partial full-update payload",
    )
  })
})
