import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
})

Object.defineProperty(globalThis, "window", {
  value: dom.window,
  configurable: true,
})
Object.defineProperty(globalThis, "document", {
  value: dom.window.document,
  configurable: true,
})
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
})
Object.defineProperty(globalThis, "HTMLElement", {
  value: dom.window.HTMLElement,
  configurable: true,
})
Object.defineProperty(globalThis, "Element", {
  value: dom.window.Element,
  configurable: true,
})

const {
  DEVICE_FORECAST_STORAGE_KEY,
  FORECAST_TTL_MS,
  getDeviceForecastExpiryDelay,
  isCrewForecast,
  readStoredDeviceForecast,
} = await import("./MyDayPage.tsx")

const validForecast = {
  jobId: "",
  jobTitle: null,
  address: "",
  condition: "Sunny",
  icon: "sun",
  temperatureHigh: 72,
  temperatureLow: 54,
  windMph: null,
  humidity: 40,
  precipitation: 0,
  fetchedAt: "2026-05-20T12:00:00.000Z",
}

beforeEach(() => {
  window.sessionStorage.clear()
})

test("isCrewForecast rejects malformed cached forecast shapes", () => {
  assert.equal(isCrewForecast({ ...validForecast, condition: { text: "Sunny" } }), false)
  assert.equal(isCrewForecast({ ...validForecast, temperatureHigh: undefined }), false)
  assert.equal(isCrewForecast({ ...validForecast, precipitation: Number.NaN }), false)
  assert.equal(isCrewForecast(validForecast), true)
})

test("readStoredDeviceForecast removes fresh but malformed cache entries", () => {
  window.sessionStorage.setItem(
    DEVICE_FORECAST_STORAGE_KEY,
    JSON.stringify({
      fetchedAt: Date.now(),
      data: {
        condition: "Sunny",
        precipitation: 0,
      },
    }),
  )

  assert.deepEqual(readStoredDeviceForecast(), { status: "idle" })
  assert.equal(window.sessionStorage.getItem(DEVICE_FORECAST_STORAGE_KEY), null)
})

test("readStoredDeviceForecast returns valid fresh cached forecasts", () => {
  window.sessionStorage.setItem(
    DEVICE_FORECAST_STORAGE_KEY,
    JSON.stringify({ fetchedAt: Date.now(), data: validForecast }),
  )

  const stored = readStoredDeviceForecast()
  assert.equal(stored.status, "ok")
  if (stored.status !== "ok") return
  assert.equal(stored.data.condition, "Sunny")
})

test("getDeviceForecastExpiryDelay returns remaining TTL for cached ok state", () => {
  assert.equal(
    getDeviceForecastExpiryDelay({
      status: "ok",
      data: validForecast,
      fetchedAt: 1_000,
    }, 1_000 + FORECAST_TTL_MS - 25),
    25,
  )
  assert.equal(
    getDeviceForecastExpiryDelay({
      status: "ok",
      data: validForecast,
      fetchedAt: 1_000,
    }, 1_000 + FORECAST_TTL_MS + 1),
    0,
  )
  assert.equal(getDeviceForecastExpiryDelay({ status: "idle" }), null)
})
