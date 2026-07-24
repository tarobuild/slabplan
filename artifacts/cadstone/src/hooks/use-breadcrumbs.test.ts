import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  BreadcrumbsProvider,
  useBreadcrumbsOverride,
  useClearBreadcrumbs,
  useSetBreadcrumbs,
} from "./use-breadcrumbs.tsx"

const source = () => readFileSync(new URL("./use-breadcrumbs.tsx", import.meta.url), "utf8")

test("breadcrumb override hooks are exported as the page-facing API", () => {
  assert.equal(typeof BreadcrumbsProvider, "function")
  assert.equal(typeof useSetBreadcrumbs, "function")
  assert.equal(typeof useBreadcrumbsOverride, "function")
  assert.equal(typeof useClearBreadcrumbs, "function")

  const text = source()
  assert.match(text, /export function useSetBreadcrumbs/)
  assert.match(text, /export function useClearBreadcrumbs/)
})
