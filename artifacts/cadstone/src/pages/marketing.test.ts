import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./marketing.tsx", import.meta.url), "utf8")
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8")

test("marketing page demonstrates the complete connected product workflow", () => {
  for (const requiredCopy of [
    "Leads & clients",
    "Job command",
    "Field execution",
    "Financial control",
    "SlabPlan assistant",
    "Sample workspace",
    "Up to 25 team members",
  ]) {
    assert.match(source, new RegExp(requiredCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
})

test("marketing preview data is explicitly identified as illustrative", () => {
  assert.match(source, /The details below are illustrative; the workflows are/)
  assert.match(source, /Sample workspace/)
  assert.match(source, /Illustrative sample/)
  assert.doesNotMatch(source, /customer testimonial/i)
})

test("field execution preview uses representative installation media", () => {
  for (const imagePath of [
    "/marketing/field-install-overview.jpg",
    "/marketing/field-seam-detail.jpg",
    "/marketing/field-edge-inspection.jpg",
  ]) {
    assert.match(source, new RegExp(imagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
})

test("public document metadata describes SlabPlan and provides social sharing cards", () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.slabplan\.com\/" \/>/)
  assert.match(html, /property="og:image" content="https:\/\/www\.slabplan\.com\/opengraph\.jpg"/)
  assert.match(html, /name="twitter:card" content="summary_large_image"/)
})
