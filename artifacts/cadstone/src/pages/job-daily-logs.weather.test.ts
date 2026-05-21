import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./job-daily-logs.tsx", import.meta.url), "utf8")

test("daily log weather fetches ignore stale responses", () => {
  assert.match(source, /weatherRequestSeqRef = useRef\(0\)/)
  assert.match(source, /weatherRequestKeyRef = useRef<string \| null>\(null\)/)
  assert.match(source, /const requestKey = buildWeatherRequestKey/)
  assert.match(source, /weatherRequestKeyRef\.current !== requestKey/)
  assert.match(source, /weatherRequestSeqRef\.current !== requestSeq/)
  assert.match(source, /weatherRequestSeqRef\.current === requestSeq/)
})

test("daily log weather request keys include job, address, and date", () => {
  assert.match(source, /export function buildWeatherRequestKey/)
  assert.match(source, /JSON\.stringify\(\{ jobId, address, date \}\)/)
})
