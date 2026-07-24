import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { test } from "node:test"

test("notification bell is wired to the in-app notification API", async () => {
  const source = await readFile(
    path.resolve(import.meta.dirname, "NotificationBell.tsx"),
    "utf8",
  )

  assert.match(source, /\/notifications\?limit=10/)
  assert.match(source, /`\/notifications\/\$\{item\.id\}\/read`/)
  assert.match(source, /\/notifications\/read-all/)
  assert.match(source, /60_000/)
})

test("top nav renders the notification bell for signed-in users", async () => {
  const source = await readFile(
    path.resolve(import.meta.dirname, "TopNav.tsx"),
    "utf8",
  )

  assert.match(source, /import NotificationBell from "\.\/NotificationBell"/)
  assert.match(source, /\{user \? <NotificationBell \/> : null\}/)
})
