import { describe, it, before } from "node:test"
import assert from "node:assert/strict"

// JSDOM has to be installed and assigned to the globals BEFORE React
// + react-dom load — react-dom captures `document` at module scope.
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
})

// Some host globals (notably `navigator`) are defined as read-only
// getters on Node 24's globalThis. Use defineProperty with `configurable`
// so we can swap them in without TypeError.
function defineGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  })
}

defineGlobal("window", dom.window)
defineGlobal("document", dom.window.document)
defineGlobal("navigator", dom.window.navigator)
defineGlobal("HTMLElement", dom.window.HTMLElement)
defineGlobal("Element", dom.window.Element)
defineGlobal("Node", dom.window.Node)
defineGlobal("getComputedStyle", dom.window.getComputedStyle)

// React 18 schedules work — let it know it's a test environment so
// state updates flush synchronously inside `act`.
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const React = await import("react")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react-dom/test-utils")
const { ErrorBoundary } = await import("./ErrorBoundary.tsx")

function Boom(): React.ReactElement {
  throw new Error("kaboom")
}

function Hello(): React.ReactElement {
  return React.createElement("p", { "data-testid": "hello" }, "ok")
}

describe("ErrorBoundary", () => {
  before(() => {
    // Silence the expected React 18 "logged a recoverable error" noise so
    // the test output stays clean. We still assert on the rendered DOM.
    const original = console.error
    ;(console as any).error = (...args: unknown[]) => {
      const first = args[0]
      if (typeof first === "string" && /kaboom|App ErrorBoundary/.test(first)) {
        return
      }
      if (first instanceof Error && /kaboom/.test(first.message)) {
        return
      }
      original.apply(console, args as never)
    }
  })

  it("getDerivedStateFromError flips hasError to true", () => {
    const next = ErrorBoundary.getDerivedStateFromError()
    assert.deepEqual(next, { hasError: true })
  })

  it("renders children when no error is thrown", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        React.createElement(ErrorBoundary, null, React.createElement(Hello)),
      )
    })

    assert.match(container.innerHTML, /data-testid="hello"/)
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it("renders the fallback Reload card when a child throws", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        React.createElement(ErrorBoundary, null, React.createElement(Boom)),
      )
    })

    // The boundary swaps in its fallback card with the "Reload" button.
    assert.match(container.textContent ?? "", /Something went wrong/)
    assert.match(container.textContent ?? "", /Reload/)
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
