import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let orgAAdminToken: string;

const runId = crypto.randomUUID();
const userId = crypto.randomUUID();
const orgAId = crypto.randomUUID();
const orgBId = crypto.randomUUID();
const orgAConversationId = crypto.randomUUID();
const orgBConversationId = crypto.randomUUID();

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://stub.invalid";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-key";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { currentYearMonth } = await import("../src/lib/agent/usage.ts");
  const { db } = await import("@workspace/db");
  const {
    agentConversations,
    agentMessages,
    agentUsageMonthly,
    organizationMemberships,
    organizations,
    users,
  } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(organizations).values([
    {
      id: orgAId,
      name: `Agent Tenant A ${runId}`,
      slug: `agent-tenant-a-${runId}`,
      status: "active",
    },
    {
      id: orgBId,
      name: `Agent Tenant B ${runId}`,
      slug: `agent-tenant-b-${runId}`,
      status: "active",
    },
  ]);

  await db.insert(users).values({
    id: userId,
    email: `agent-admin-${runId}@tenant.local`,
    passwordHash: "test-not-a-real-hash",
    fullName: "Agent Tenant Admin",
    role: "admin",
    defaultOrganizationId: orgAId,
  });

  await db.insert(organizationMemberships).values([
    {
      organizationId: orgAId,
      userId,
      role: "admin",
      isDefault: true,
    },
    {
      organizationId: orgBId,
      userId,
      role: "admin",
      isDefault: false,
    },
  ]);

  await db.insert(agentConversations).values([
    {
      id: orgAConversationId,
      organizationId: orgAId,
      userId,
      title: `Agent Tenant A Conversation ${runId}`,
    },
    {
      id: orgBConversationId,
      organizationId: orgBId,
      userId,
      title: `Agent Tenant B Conversation ${runId}`,
    },
  ]);

  await db.insert(agentMessages).values({
    organizationId: orgBId,
    conversationId: orgBConversationId,
    role: "user",
    content: "Foreign tenant message",
  });

  const ym = currentYearMonth();
  await db.insert(agentUsageMonthly).values([
    {
      organizationId: orgAId,
      userId,
      yearMonth: ym,
      inputTokens: 10,
      outputTokens: 15,
      requests: 1,
    },
    {
      organizationId: orgBId,
      userId,
      yearMonth: ym,
      inputTokens: 1000,
      outputTokens: 2000,
      requests: 7,
    },
  ]);

  orgAAdminToken = auth.signAccessToken({
    id: userId,
    email: `agent-admin-${runId}@tenant.local`,
    fullName: "Agent Tenant Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    defaultOrganizationId: orgAId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  const { db, pool } = await import("@workspace/db");
  const {
    agentConversations,
    agentMessages,
    agentUsageMonthly,
    organizationMemberships,
    organizations,
    users,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    await db
      .delete(agentMessages)
      .where(inArray(agentMessages.conversationId, [orgAConversationId, orgBConversationId]));
    await db
      .delete(agentConversations)
      .where(inArray(agentConversations.id, [orgAConversationId, orgBConversationId]));
    await db.delete(agentUsageMonthly).where(inArray(agentUsageMonthly.userId, [userId]));
    await db.delete(organizationMemberships).where(inArray(organizationMemberships.userId, [userId]));
    await db.delete(users).where(inArray(users.id, [userId]));
    await db.delete(organizations).where(inArray(organizations.id, [orgAId, orgBId]));
  } finally {
    await pool.end();
  }
});

test("agent conversations, messages, and usage are scoped to the active organization", async () => {
  const list = await fetch(`${baseUrl}/agent/conversations`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(list.status, 200);
  const listBody = (await list.json()) as { conversations: Array<{ id: string }> };
  assert.equal(listBody.conversations.some((row) => row.id === orgAConversationId), true);
  assert.equal(listBody.conversations.some((row) => row.id === orgBConversationId), false);

  const foreignMessages = await fetch(`${baseUrl}/agent/conversations/${orgBConversationId}/messages`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(foreignMessages.status, 404);

  const usage = await fetch(`${baseUrl}/agent/usage/org`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(usage.status, 200);
  const usageBody = (await usage.json()) as {
    inputTokens: number;
    outputTokens: number;
    requests: number;
  };
  assert.equal(usageBody.inputTokens, 10);
  assert.equal(usageBody.outputTokens, 15);
  assert.equal(usageBody.requests, 1);
});
