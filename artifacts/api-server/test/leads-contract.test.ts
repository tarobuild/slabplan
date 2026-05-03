// Contract test: ensure the generated zod schemas in `@workspace/api-zod`
// (derived from lib/api-spec/openapi.yaml) agree with the actual handler
// schema in artifacts/api-server/src/routes/leads.ts on the same class of
// drift that bit Jobs in task #289.
//
// The handler's `optionalDate` transform accepts only `YYYY-MM-DD` strings
// and never coerces to a `Date`. The spec used to mark `projectedSalesDate`
// as `format: date`, which orval compiled to `z.coerce.date()` — so
// generated clients silently turned ISO timestamps into `Date` objects and
// MCP callers got confusing 400s from the handler.
//
// If this regresses, this test fails before any MCP/generated-client
// caller hits the wire.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LeadsPostLeadsBody,
  LeadsPutLeadsIdBody,
} from "@workspace/api-zod";

function basePayload() {
  return {
    title: "Downtown remodel",
    streetAddress: "123 Main St",
    city: "Austin",
    state: "TX",
    zipCode: "78701",
    confidence: 50,
    projectedSalesDate: "2026-04-01",
    estimatedRevenueMin: "10000",
    estimatedRevenueMax: "20000",
    status: "open" as const,
    projectType: "kitchen",
    notes: null,
    leadSource: null,
    salespeople: [],
    tags: [],
    sources: [],
  };
}

test("POST /leads body schema accepts a fully-valid payload", () => {
  const result = LeadsPostLeadsBody.safeParse(basePayload());
  assert.equal(result.success, true, JSON.stringify(result, null, 2));
});

test("POST /leads body schema rejects an ISO-timestamp projectedSalesDate (handler accepts only YYYY-MM-DD)", () => {
  const result = LeadsPostLeadsBody.safeParse({
    ...basePayload(),
    projectedSalesDate: "2026-04-01T00:00:00.000Z",
  });
  assert.equal(result.success, false);
});

test("POST /leads body schema rejects a slash-formatted projectedSalesDate", () => {
  const result = LeadsPostLeadsBody.safeParse({
    ...basePayload(),
    projectedSalesDate: "04/01/2026",
  });
  assert.equal(result.success, false);
});

test("POST /leads body schema keeps projectedSalesDate as a plain string (no Date coercion)", () => {
  const result = LeadsPostLeadsBody.safeParse(basePayload());
  assert.equal(result.success, true);
  if (result.success) {
    // The handler stores YYYY-MM-DD as a string, never a Date. If orval ever
    // re-introduces `z.coerce.date()` here this assertion fails before any
    // MCP call hits the wire.
    assert.equal(typeof result.data.projectedSalesDate, "string");
    assert.equal(result.data.projectedSalesDate, "2026-04-01");
  }
});

test("PUT /leads/{id} body schema also rejects an ISO-timestamp projectedSalesDate", () => {
  const result = LeadsPutLeadsIdBody.safeParse({
    ...basePayload(),
    projectedSalesDate: "2026-04-01T00:00:00.000Z",
  });
  assert.equal(result.success, false);
});

test("PUT /leads/{id} body schema accepts a YYYY-MM-DD projectedSalesDate as a string", () => {
  const result = LeadsPutLeadsIdBody.safeParse(basePayload());
  assert.equal(result.success, true, JSON.stringify(result, null, 2));
  if (result.success) {
    assert.equal(typeof result.data.projectedSalesDate, "string");
  }
});

test("POST /leads body schema accepts a null projectedSalesDate", () => {
  const result = LeadsPostLeadsBody.safeParse({
    ...basePayload(),
    projectedSalesDate: null,
  });
  assert.equal(result.success, true, JSON.stringify(result, null, 2));
});
