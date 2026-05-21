import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./carousel.tsx", import.meta.url), "utf8")

test("Carousel removes every Embla event listener it registers", () => {
  const effect = source.slice(
    source.indexOf('api.on("reInit", onSelect)'),
    source.indexOf("}, [api, onSelect])"),
  )

  assert.match(effect, /api\.on\("reInit", onSelect\)/)
  assert.match(effect, /api\.on\("select", onSelect\)/)
  assert.match(effect, /api\?\.off\("reInit", onSelect\)/)
  assert.match(effect, /api\?\.off\("select", onSelect\)/)
})
