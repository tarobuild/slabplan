import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./navigation-menu.tsx", import.meta.url), "utf8")

test("NavigationMenuTrigger omits Radix asChild from its wrapper props", () => {
  assert.match(source, /type NavigationMenuTriggerProps = Omit</)
  assert.match(
    source,
    /React\.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive\.Trigger>,\s+"asChild"\s+>/s,
  )
  assert.match(source, /NavigationMenuTriggerProps/)
  assert.match(source, /<ChevronDown[\s\S]*aria-hidden="true"/)
})
