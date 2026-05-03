// Contract test: ensure the generated zod schemas in `@workspace/api-zod`
// (derived from lib/api-spec/openapi.yaml) agree with the actual handler
// schemas in artifacts/api-server/src/routes/jobs.ts on the three drift
// points called out in task #289:
//
//   1. date format — handler accepts only `YYYY-MM-DD` strings, never any
//      other ISO-8601 form. The spec used to say `format: date` (which orval
//      compiles to `z.coerce.date()`) and silently coerced ISO timestamps
//      into `Date` objects.
//   2. money — `contractValueCents` / `amountPaidCents` are bounded by
//      `Number.MAX_SAFE_INTEGER`. The spec used to say `format: int64`
//      which orval compiled to `bigint` in one of the generated client
//      types.
//   3. clientId — required on `POST /jobs`, optional on `PUT /jobs/:id`.
//      The spec used to mark it `nullable` on both, so an MCP client that
//      omitted it on POST got a confusing 400 from the handler instead of
//      being caught by the generated client schema.
//
// If any of these regress, this test fails before MCP/generated-client
// callers see a confusing 400 in production.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  JobsPostJobsBody,
  JobsPutJobsIdBody,
} from "@workspace/api-zod";

const VALID_CLIENT_ID = "11111111-1111-4111-8111-111111111111";

function basePayload() {
  return {
    title: "Kitchen remodel",
    status: "open" as const,
    streetAddress: "123 Main St",
    city: "Austin",
    state: "TX",
    zipCode: "78701",
    contractPrice: "12345.67",
    jobType: "kitchen_countertops",
    workDays: null,
    projectedStart: "2026-04-01",
    projectedCompletion: "2026-06-15",
    actualStart: null,
    actualCompletion: null,
    contractType: "fixed_price" as const,
    internalNotes: null,
    subVendorNotes: null,
    squareFeet: null,
    permitNumber: null,
    projectManagerId: null,
    contractValueCents: 1_500_000,
    amountPaidCents: 250_000,
  };
}

test("POST /jobs body schema accepts a fully-valid payload with clientId", () => {
  const result = JobsPostJobsBody.safeParse({
    ...basePayload(),
    clientId: VALID_CLIENT_ID,
  });
  assert.equal(result.success, true, JSON.stringify(result, null, 2));
});

test("POST /jobs body schema rejects a payload missing clientId (handler-level rule)", () => {
  const result = JobsPostJobsBody.safeParse(basePayload());
  assert.equal(result.success, false);
});

test("POST /jobs body schema rejects an ISO-timestamp date (handler accepts only YYYY-MM-DD)", () => {
  const result = JobsPostJobsBody.safeParse({
    ...basePayload(),
    clientId: VALID_CLIENT_ID,
    projectedStart: "2026-04-01T00:00:00.000Z",
  });
  assert.equal(result.success, false);
});

test("POST /jobs body schema rejects a slash-formatted date (handler accepts only YYYY-MM-DD)", () => {
  const result = JobsPostJobsBody.safeParse({
    ...basePayload(),
    clientId: VALID_CLIENT_ID,
    projectedStart: "04/01/2026",
  });
  assert.equal(result.success, false);
});

test("POST /jobs body schema keeps date fields as plain strings (no Date coercion)", () => {
  const result = JobsPostJobsBody.safeParse({
    ...basePayload(),
    clientId: VALID_CLIENT_ID,
  });
  assert.equal(result.success, true);
  if (result.success) {
    // The handler stores YYYY-MM-DD as a string, never a Date. If orval ever
    // re-introduces `z.coerce.date()` here this assertion fails before any
    // MCP call hits the wire.
    assert.equal(typeof result.data.projectedStart, "string");
    assert.equal(result.data.projectedStart, "2026-04-01");
    assert.equal(typeof result.data.projectedCompletion, "string");
  }
});

test("POST /jobs body schema accepts money fields up to Number.MAX_SAFE_INTEGER", () => {
  const result = JobsPostJobsBody.safeParse({
    ...basePayload(),
    clientId: VALID_CLIENT_ID,
    contractValueCents: Number.MAX_SAFE_INTEGER,
    amountPaidCents: 0,
  });
  assert.equal(result.success, true, JSON.stringify(result, null, 2));
  if (result.success) {
    // The generated type must remain `number`, never `bigint`.
    assert.equal(typeof result.data.contractValueCents, "number");
  }
});

test("POST /jobs body schema rejects money fields above Number.MAX_SAFE_INTEGER", () => {
  const result = JobsPostJobsBody.safeParse({
    ...basePayload(),
    clientId: VALID_CLIENT_ID,
    contractValueCents: Number.MAX_SAFE_INTEGER + 1,
  });
  assert.equal(result.success, false);
});

test("POST /jobs body schema rejects negative money", () => {
  const result = JobsPostJobsBody.safeParse({
    ...basePayload(),
    clientId: VALID_CLIENT_ID,
    contractValueCents: -1,
  });
  assert.equal(result.success, false);
});

test("PUT /jobs/{id} body schema accepts a payload WITHOUT clientId (PUT does not require it)", () => {
  const result = JobsPutJobsIdBody.safeParse(basePayload());
  assert.equal(result.success, true, JSON.stringify(result, null, 2));
});

test("PUT /jobs/{id} body schema also rejects an ISO-timestamp date", () => {
  const result = JobsPutJobsIdBody.safeParse({
    ...basePayload(),
    projectedStart: "2026-04-01T00:00:00.000Z",
  });
  assert.equal(result.success, false);
});

test("PUT /jobs/{id} body schema bounds money at Number.MAX_SAFE_INTEGER (never bigint)", () => {
  const ok = JobsPutJobsIdBody.safeParse({
    ...basePayload(),
    contractValueCents: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(ok.success, true);
  const bad = JobsPutJobsIdBody.safeParse({
    ...basePayload(),
    contractValueCents: Number.MAX_SAFE_INTEGER + 1,
  });
  assert.equal(bad.success, false);
});
