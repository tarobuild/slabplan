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
  test("renders assistant markdown tables as readable data rows", async () => {
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
    assert.ok(renderedText.includes("Open Jobs (1)"))
    assert.ok(renderedText.includes("Codex Readiness Countertops"))
    assert.ok(renderedText.includes("Type"))
    assert.ok(renderedText.includes("Kitchen Countertops"))
    assert.ok(!renderedText.includes("|---|---|---|---|"))
    assert.ok(!renderedText.includes("###"))
  })
})
