import assert from "node:assert/strict";
import test from "node:test";

import { extractCitations } from "../src/lib/agent/citations.ts";

const CONTACT_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const SCHEDULE_ITEM_ID = "33333333-3333-3333-3333-333333333333";
const JOB_ID = "44444444-4444-4444-4444-444444444444";
const ACTIVITY_ID = "55555555-5555-5555-5555-555555555555";

test("extractCitations rolls list_contacts results up to client citations", () => {
  const citations = extractCitations("list_contacts", {
    contacts: [
      {
        id: CONTACT_ID,
        clientId: CLIENT_ID,
        fullName: "Jane Client",
      },
    ],
  });

  assert.deepEqual(citations, [
    {
      kind: "client",
      id: CLIENT_ID,
      label: "Jane Client",
    },
  ]);
});

test("extractCitations rolls get_contact wrappers up to client citations", () => {
  const citations = extractCitations("get_contact", {
    contact: {
      id: CONTACT_ID,
      client_id: CLIENT_ID,
      fullName: "Jane Client",
    },
  });

  assert.deepEqual(citations, [
    {
      kind: "client",
      id: CLIENT_ID,
      label: "Jane Client",
    },
  ]);
});

test("extractCitations harvests schedule items from data wrappers", () => {
  const citations = extractCitations("list_schedule_items", {
    data: [
      {
        id: SCHEDULE_ITEM_ID,
        jobId: JOB_ID,
        title: "Pour slab",
      },
    ],
  });

  assert.deepEqual(citations, [
    {
      kind: "schedule_item",
      id: SCHEDULE_ITEM_ID,
      label: "Pour slab",
      jobId: JOB_ID,
    },
  ]);
});

test("extractCitations harvests activity records from data wrappers", () => {
  const citations = extractCitations("read_activity", {
    data: [
      {
        id: ACTIVITY_ID,
        title: "Estimate updated",
      },
    ],
  });

  assert.deepEqual(citations, [
    {
      kind: "activity",
      id: ACTIVITY_ID,
      label: "Estimate updated",
    },
  ]);
});

test("extractCitations maps contact search results to their client", () => {
  const citations = extractCitations("search", {
    results: [
      {
        type: "contact",
        id: CONTACT_ID,
        clientId: CLIENT_ID,
        title: "Jane Client",
      },
    ],
  });

  assert.deepEqual(citations, [
    {
      kind: "client",
      id: CLIENT_ID,
      label: "Jane Client",
    },
  ]);
});
