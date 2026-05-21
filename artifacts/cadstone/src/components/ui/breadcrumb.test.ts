import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { JSDOM } from "jsdom"

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "breadcrumb.tsx")
const source = readFileSync(sourcePath, "utf8")

describe("BreadcrumbEllipsis accessibility", () => {
  it("exposes the More label while hiding only the decorative icon", () => {
    const ellipsisSource = source.slice(
      source.indexOf("const BreadcrumbEllipsis"),
      source.indexOf("BreadcrumbEllipsis.displayName"),
    )

    assert.match(ellipsisSource, /<span className="sr-only">More<\/span>/)
    assert.match(ellipsisSource, /<MoreHorizontal aria-hidden="true"/)
    assert.doesNotMatch(ellipsisSource, /role="presentation"/)
    assert.doesNotMatch(ellipsisSource, /<span\s+[^>]*aria-hidden="true"/)
  })
})

describe("Breadcrumb separator prop", () => {
  it("renders the custom separator without forwarding it to the nav", async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
      url: "http://localhost/",
      pretendToBeVisual: true,
    })

    function defineGlobal(key: string, value: unknown) {
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
      })
    }

    defineGlobal("window", dom.window)
    defineGlobal("document", dom.window.document)
    defineGlobal("navigator", dom.window.navigator)
    defineGlobal("HTMLElement", dom.window.HTMLElement)
    defineGlobal("Node", dom.window.Node)
    defineGlobal("Element", dom.window.Element)

    const React = await import("react")
    const { createElement } = React
    defineGlobal("React", React)
    const { act } = await import("react")
    const { createRoot } = await import("react-dom/client")
    const {
      Breadcrumb,
      BreadcrumbItem,
      BreadcrumbList,
      BreadcrumbPage,
      BreadcrumbSeparator,
    } = await import("./breadcrumb.tsx")

    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = dom.window.document.getElementById("root") as HTMLDivElement
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(
          Breadcrumb,
          { separator: "|" },
          createElement(
            BreadcrumbList,
            null,
            createElement(BreadcrumbItem, null, "Jobs"),
            createElement(BreadcrumbSeparator),
            createElement(BreadcrumbItem, null, createElement(BreadcrumbPage, null, "Active")),
          ),
        ),
      )
    })

    const nav = container.querySelector("nav")
    assert.equal(nav?.getAttribute("separator"), null)
    assert.match(container.textContent ?? "", /Jobs\|Active/)

    await act(async () => {
      root.unmount()
    })
  })
})
