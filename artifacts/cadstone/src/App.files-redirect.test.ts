import assert from "node:assert/strict"
import { afterEach, before, beforeEach, describe, test } from "node:test"

import type { AuthUser } from "@/store/auth"

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
const { MemoryRouter, Route, Routes } = await import("react-router-dom")
const { useAuthStore } = await import("@/store/auth")
const { FilesRedirect } = await import("./App.tsx")

const CLIENTS_MARKER = "CLIENTS_LANDING"
const JOBS_MARKER = "JOBS_LANDING"

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

before(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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
  useAuthStore.getState().clearAuth()
})

function setUserRole(role: AuthUser["role"]) {
  useAuthStore.getState().setAuth(
    {
      id: "user-1",
      email: "test@example.com",
      fullName: "Test User",
      role,
      avatarUrl: null,
      phone: null,
    },
    "test-token",
  )
}

async function renderFilesRedirect(initialPath: string) {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [initialPath] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/files",
            element: createElement(FilesRedirect),
          }),
          createElement(Route, {
            path: "/files/documents",
            element: createElement(FilesRedirect),
          }),
          createElement(Route, {
            path: "/files/photos",
            element: createElement(FilesRedirect),
          }),
          createElement(Route, {
            path: "/files/videos",
            element: createElement(FilesRedirect),
          }),
          createElement(Route, {
            path: "/clients",
            element: createElement("div", null, CLIENTS_MARKER),
          }),
          createElement(Route, {
            path: "/jobs",
            element: createElement("div", null, JOBS_MARKER),
          }),
        ),
      ),
    )
  })
}

describe("legacy files compatibility redirects", () => {
  const legacyFilesRoutes = [
    "/files",
    "/files/documents",
    "/files/photos",
    "/files/videos",
  ] as const

  for (const initialPath of legacyFilesRoutes) {
    test(`${initialPath} sends admins to clients`, async () => {
      setUserRole("admin")

      await renderFilesRedirect(initialPath)

      assert.match(container.textContent ?? "", new RegExp(CLIENTS_MARKER))
      assert.doesNotMatch(container.textContent ?? "", new RegExp(JOBS_MARKER))
    })

    test(`${initialPath} sends project managers to jobs`, async () => {
      setUserRole("project_manager")

      await renderFilesRedirect(initialPath)

      assert.match(container.textContent ?? "", new RegExp(JOBS_MARKER))
      assert.doesNotMatch(container.textContent ?? "", new RegExp(CLIENTS_MARKER))
    })

    test(`${initialPath} sends crew members to jobs`, async () => {
      setUserRole("crew_member")

      await renderFilesRedirect(initialPath)

      assert.match(container.textContent ?? "", new RegExp(JOBS_MARKER))
      assert.doesNotMatch(container.textContent ?? "", new RegExp(CLIENTS_MARKER))
    })
  }
})
