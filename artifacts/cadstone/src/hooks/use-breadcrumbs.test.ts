import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  BreadcrumbsProvider,
  useBreadcrumbsOverride,
  useClearBreadcrumbs,
  useSetBreadcrumbs,
  type BreadcrumbItem,
} from "./use-breadcrumbs"

describe("breadcrumb hook public API", () => {
  it("exports page-facing setter and clearer hooks", () => {
    assert.equal(typeof BreadcrumbsProvider, "function")
    assert.equal(typeof useBreadcrumbsOverride, "function")
    assert.equal(typeof useSetBreadcrumbs, "function")
    assert.equal(typeof useClearBreadcrumbs, "function")

    const item: BreadcrumbItem = { label: "Client", to: "/clients/123" }
    assert.deepEqual(item, { label: "Client", to: "/clients/123" })
  })
})
