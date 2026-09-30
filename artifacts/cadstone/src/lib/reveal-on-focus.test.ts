import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { FocusEvent } from "react"
import { revealOnFocus } from "./reveal-on-focus.ts"

test("revealOnFocus scrolls the focused item to the nearest edge", () => {
  const calls: unknown[] = []
  const target = { scrollIntoView: (options: unknown) => calls.push(options) }
  revealOnFocus({ currentTarget: target } as unknown as FocusEvent<HTMLElement>)
  assert.deepEqual(calls, [{ block: "nearest", inline: "nearest" }])
})

test("revealOnFocus tolerates environments without scrollIntoView", () => {
  assert.doesNotThrow(() =>
    revealOnFocus({ currentTarget: {} } as unknown as FocusEvent<HTMLElement>),
  )
})

test("every horizontal pill/chip strip reveals focused items and pads its scroller", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
  const settings = read("../pages/settings/SettingsLayout.tsx")
  assert.match(settings, /className="scrollbar-none -mx-4 scroll-px-4 overflow-x-auto md:hidden"/)
  assert.match(settings, /<ul className="flex w-max gap-2 px-4 py-1\.5">/)
  assert.match(settings, /data-settings-chip\s*onFocus=\{revealOnFocus\}/)

  const job = read("../pages/job-detail.tsx")
  assert.match(job, /aria-label="Job sections"\s*className="[^"]*scroll-px-1\.5[^"]*p-1\.5[^"]*"/)
  assert.match(job, /aria-current=\{isActive \? "page" : undefined\}\s*onFocus=\{revealOnFocus\}/)

  const reports = read("../pages/reports/index.tsx")
  assert.match(reports, /className="[^"]*scroll-px-1\.5[^"]*overflow-x-auto p-1\.5[^"]*"/)
  assert.match(reports, /to=\{t\.to\}\s*onFocus=\{revealOnFocus\}/)
})
