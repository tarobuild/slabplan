import assert from "node:assert/strict";
import { test } from "node:test";

import type { ApiClient } from "./api-client";
import { TOOL_DEFINITIONS } from "./tools";

function tool(name: string) {
  const definition = TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
  assert.ok(definition, `Expected tool ${name}`);
  return definition;
}

function fakeClient() {
  const requests: Array<{
    method: string;
    path: string;
    body?: unknown;
    toolName?: string;
  }> = [];
  const client = {
    async request(args: {
      method: string;
      path: string;
      body?: unknown;
      toolName?: string;
    }) {
      requests.push(args);
      return { data: { ok: true } };
    },
  } as unknown as ApiClient;

  return { client, requests };
}

test("update_schedule_item sends only the patch fields without read/merge PUT", async () => {
  const { client, requests } = fakeClient();

  await tool("update_schedule_item").handler(client, {
    id: "schedule-1",
    title: "Updated title",
  });

  assert.deepEqual(requests, [
    {
      method: "PATCH",
      path: "/schedule-items/schedule-1",
      body: { title: "Updated title" },
      toolName: "update_schedule_item",
      idempotencyKey: undefined,
    },
  ]);
});

test("add_schedule_assignee uses atomic add endpoint without replacing assigneeIds", async () => {
  const { client, requests } = fakeClient();

  await Promise.all([
    tool("add_schedule_assignee").handler(client, {
      scheduleItemId: "schedule-1",
      userId: "user-a",
    }),
    tool("add_schedule_assignee").handler(client, {
      scheduleItemId: "schedule-1",
      userId: "user-b",
    }),
  ]);

  assert.deepEqual(requests.map((request) => request.method), ["POST", "POST"]);
  assert.deepEqual(requests.map((request) => request.path), [
    "/schedule-items/schedule-1/assignees",
    "/schedule-items/schedule-1/assignees",
  ]);
  assert.deepEqual(requests.map((request) => request.body), [
    { userId: "user-a" },
    { userId: "user-b" },
  ]);
});

test("mark_schedule_done uses the narrow completion endpoint", async () => {
  const { client, requests } = fakeClient();

  await tool("mark_schedule_done").handler(client, {
    id: "schedule-1",
    isComplete: true,
  });

  assert.deepEqual(requests, [
    {
      method: "POST",
      path: "/schedule-items/schedule-1/complete",
      body: { isComplete: true, progress: 100 },
      toolName: "mark_schedule_done",
      idempotencyKey: undefined,
    },
  ]);
});

test("mark_schedule_done does not reset progress when marking incomplete", async () => {
  const { client, requests } = fakeClient();

  await tool("mark_schedule_done").handler(client, {
    id: "schedule-1",
    isComplete: false,
  });

  assert.deepEqual(requests, [
    {
      method: "POST",
      path: "/schedule-items/schedule-1/complete",
      body: { isComplete: false },
      toolName: "mark_schedule_done",
      idempotencyKey: undefined,
    },
  ]);
});
