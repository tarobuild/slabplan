import assert from "node:assert/strict"
import { afterEach, before, beforeEach, describe, test } from "node:test"

import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
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
defineGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window))

const React = await import("react")
const { createElement } = React
const { act } = await import("react")
const { createRoot } = await import("react-dom/client")
const { MemoryRouter } = await import("react-router-dom")
const { default: ChatMessage } = await import("./ChatMessage.tsx")

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

before(() => {
  ;(
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  container = dom.window.document.createElement("div")
  dom.window.document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

describe("ChatMessage", () => {
  test("renders assistant markdown tables with accessible headers and cells", async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(ChatMessage, {
            message: {
              id: "message-1",
              conversationId: "conversation-1",
              role: "assistant",
              content:
                "### 🔨 Open Jobs (1)\n\n| Title | Type | Location | Contract Price |\n|---|---|---|---|\n| **Codex Readiness Countertops** | Kitchen Countertops | Austin, TX | $12,345 |\n\n---\n\n**Summary:**\n- **1 open job** with a fixed-price contract.",
              toolCalls: null,
              citations: null,
              inputTokens: null,
              outputTokens: null,
              stoppedReason: null,
              createdAt: new Date(0).toISOString(),
            },
          }),
        ),
      )
    })

    const renderedText = container.textContent ?? ""
    assert.ok(container.querySelector('[data-message-table="true"]'))
    assert.equal(container.querySelectorAll("thead th[scope=col]").length, 4)
    assert.equal(container.querySelectorAll("tbody td").length, 4)
    assert.equal(container.querySelector('[role="region"]')?.getAttribute("tabindex"), "0")
    assert.ok(renderedText.includes("Open Jobs (1)"))
    assert.ok(renderedText.includes("Codex Readiness Countertops"))
    assert.ok(renderedText.includes("Type"))
    assert.ok(renderedText.includes("Kitchen Countertops"))
    assert.ok(!renderedText.includes("|---|---|---|---|"))
    assert.ok(!renderedText.includes("###"))
  })

  test("renders lists, escaped table pipes, code blocks, and safe links without loading model images", async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ChatMessage, {
        message: {
          id: "formatted", conversationId: "conversation-1", role: "assistant",
          content: "## Next steps\n\n1. Review **scope**\n2. Confirm _dates_\n\n| Material | Amount |\n|:---|---:|\n| Stone \\| Quartz | $1,200 |\n\n```text\n<private> remains text\n```\n\n[Reference](https://example.com/project)\n\n[Unsafe](javascript:alert(1))\n\n![Tracking](https://example.com/pixel.png)\n\n<script>alert(1)</script><img src=x onerror=alert(1)>",
          citations: null, toolCalls: null, inputTokens: null, outputTokens: null, stoppedReason: null, createdAt: new Date(0).toISOString(),
        },
      })))
    })
    assert.equal(container.querySelectorAll("ol > li").length, 2)
    assert.equal(container.querySelector("td")?.textContent, "Stone | Quartz")
    assert.equal(container.querySelectorAll("td").length, 2)
    assert.ok(container.querySelector("pre code")?.textContent?.includes("<private>"))
    assert.equal(container.querySelector("a")?.getAttribute("rel"), "noopener noreferrer")
    assert.equal(container.querySelectorAll("a").length, 1)
    assert.equal(container.querySelectorAll("script, img, iframe").length, 0)
  })

  test("keeps user messages as literal text", async () => {
    await act(async () => { root.render(createElement(ChatMessage, { message: { id: "literal", conversationId: "conversation-1", role: "user", content: "**My text** <img src=x>", toolCalls: null, citations: null, inputTokens: null, outputTokens: null, stoppedReason: null, createdAt: new Date(0).toISOString() } })) })
    assert.ok(container.textContent?.includes("**My text** <img src=x>"))
    assert.equal(container.querySelectorAll("strong, img").length, 0)
  })
})
