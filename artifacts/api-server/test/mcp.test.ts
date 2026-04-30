import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let patSecret: string;
let patId: string;

const adminUserId = crypto.randomUUID();
const adminEmail = `mcp-admin-${adminUserId}@mcp-test.local`;

const REQUIRED_TOOLS = [
  // Jobs
  "list_jobs",
  "get_job",
  "create_job",
  "update_job",
  "delete_job",
  // Leads
  "list_leads",
  "get_lead",
  "create_lead",
  "update_lead",
  "delete_lead",
  // Clients + contacts
  "list_clients",
  "get_client",
  "create_client",
  "update_client",
  "delete_client",
  "list_contacts",
  "get_contact",
  "create_client_contact",
  "update_contact",
  "delete_contact",
  // Daily logs
  "list_daily_logs",
  "get_daily_log",
  "create_daily_log",
  "update_daily_log",
  "delete_daily_log",
  "add_todo",
  "complete_todo",
  // Schedule
  "list_schedule_items",
  "get_schedule_item",
  "create_schedule_item",
  "update_schedule_item",
  "delete_schedule_item",
  "add_schedule_assignee",
  "mark_schedule_done",
  // Files + folders
  "list_folders",
  "create_folder",
  "get_folder",
  "rename_folder",
  "move_folder",
  "delete_folder",
  "list_files",
  "attach_file",
  "get_file",
  "rename_file",
  "move_file",
  "delete_file",
  // Search + activity + users
  "search",
  "read_activity",
  "list_users",
  "whoami",
  // Escape hatch
  "request",
];

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const { db } = await import("@workspace/db");
  const { users, personalAccessTokens } = await import("@workspace/db/schema");
  const { generateRawToken } = await import("../src/lib/personal-access-tokens.ts");

  await prepareApp();

  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ MCP Admin",
    role: "admin",
  });

  const generated = generateRawToken();
  patSecret = generated.secret;
  const [patRow] = await db
    .insert(personalAccessTokens)
    .values({
      userId: adminUserId,
      name: "MCP test token",
      scope: "read_write",
      tokenHash: generated.tokenHash,
      tokenPrefix: generated.prefix,
      lastFour: generated.lastFour,
    })
    .returning({ id: personalAccessTokens.id });
  patId = patRow!.id;

  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  // The MCP HTTP handler defaults its loopback fetch target to
  // http://127.0.0.1:${PORT}. Point it at our randomly-bound test port so
  // tool calls resolve back to the same in-process app.
  process.env.PORT = String(address.port);
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  const { db, pool } = await import("@workspace/db");
  const { users, personalAccessTokens, leads, activityLog } = await import(
    "@workspace/db/schema"
  );
  const { eq } = await import("drizzle-orm");

  // Best-effort cleanup: leads + activity rows owned by our test user, then
  // the PAT, then the user itself.
  await db.delete(activityLog).where(eq(activityLog.userId, adminUserId));
  await db.delete(leads).where(eq(leads.createdBy, adminUserId));
  await db.delete(personalAccessTokens).where(eq(personalAccessTokens.userId, adminUserId));
  await db.delete(users).where(eq(users.id, adminUserId));

  await pool.end();
});

test("MCP round-trip: tool list, read+write audit, resource read, stdio audit", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );

  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${patSecret}` },
    },
  });

  const client = new Client(
    { name: "cadstone-mcp-test-client", version: "0.0.0" },
    { capabilities: {} },
  );

  const { db } = await import("@workspace/db");
  const { activityLog } = await import("@workspace/db/schema");
  const { and, eq } = await import("drizzle-orm");

  try {
    await client.connect(transport);

    // --- tool surface contract ---------------------------------------------
    const tools = await client.listTools();
    const toolNames = new Set(tools.tools.map((t) => t.name));
    const missing = REQUIRED_TOOLS.filter((name) => !toolNames.has(name));
    assert.deepEqual(missing, [], `Missing required MCP tools: ${missing.join(", ")}`);

    // --- read tool (with audit row assertion) ------------------------------
    const listJobs = await client.callTool({ name: "list_jobs", arguments: {} });
    assert.equal(listJobs.isError, undefined, "list_jobs should not be an error");
    const listJobsContent = (listJobs.content as Array<{ type: string; text?: string }>) ?? [];
    const listJobsText = listJobsContent.find((c) => c.type === "text")?.text;
    assert.ok(listJobsText, "list_jobs should produce text content");
    const listJobsParsed = JSON.parse(listJobsText!);
    assert.ok(
      listJobsParsed && typeof listJobsParsed === "object",
      "list_jobs should return a JSON object",
    );

    // The audit hook writes an mcp_tool_call row for EVERY tool call,
    // including reads. Without this, read-only tools would have no audit
    // trail at all because the underlying GET endpoints don't write to
    // activity_log.
    const readAudit = await db
      .select({
        id: activityLog.id,
        action: activityLog.action,
        userId: activityLog.userId,
        entityType: activityLog.entityType,
        entityId: activityLog.entityId,
        metadata: activityLog.metadata,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityType, "mcp_tool_call"),
          eq(activityLog.action, "list_jobs"),
          eq(activityLog.userId, adminUserId),
        ),
      )
      .limit(5);
    assert.ok(
      readAudit.length >= 1,
      "an mcp_tool_call audit row should be written for the read-only list_jobs call",
    );
    const readMeta = (readAudit[0]!.metadata ?? {}) as Record<string, unknown>;
    assert.equal(readMeta.actorKind, "agent_via_mcp", "read audit metadata.actorKind");
    assert.equal(readMeta.toolName, "list_jobs", "read audit metadata.toolName");
    assert.equal(readMeta.patId, patId, "read audit metadata.patId");
    assert.equal(readMeta.ok, true, "read audit metadata.ok");
    assert.equal(readAudit[0]!.entityId, patId, "read audit entityId tracks the PAT");

    // --- write tool --------------------------------------------------------
    const leadTitle = `MCP Test Lead ${crypto.randomUUID()}`;
    const created = await client.callTool({
      name: "create_lead",
      arguments: { title: leadTitle, status: "open" },
    });
    const createdContent = (created.content as Array<{ type: string; text?: string }>) ?? [];
    const createdText = createdContent.find((c) => c.type === "text")?.text;
    if (created.isError) {
      throw new Error(`create_lead returned an error: ${createdText}`);
    }
    assert.ok(createdText, "create_lead should produce text content");
    const createdResponse = JSON.parse(createdText!);
    const createdLead = createdResponse.lead ?? createdResponse;
    assert.equal(createdLead.title, leadTitle, "returned lead should echo our title");
    assert.ok(createdLead.id, "returned lead should have an id");

    // --- write audit tag in activity_log -----------------------------------
    const rows = await db
      .select({
        id: activityLog.id,
        action: activityLog.action,
        userId: activityLog.userId,
        metadata: activityLog.metadata,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityType, "lead"),
          eq(activityLog.entityId, createdLead.id),
          eq(activityLog.action, "created"),
        ),
      )
      .limit(1);

    assert.equal(rows.length, 1, "activity_log should contain a 'lead created' row");
    const row = rows[0]!;
    assert.equal(row.userId, adminUserId, "activity row should be attributed to PAT user");

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    assert.equal(meta.actorKind, "agent_via_mcp", "metadata.actorKind should be agent_via_mcp");
    assert.equal(meta.toolName, "create_lead", "metadata.toolName should be create_lead");
    assert.equal(meta.patId, patId, "metadata.patId should match the calling PAT");
    assert.match(
      String(meta.actor ?? ""),
      /^agent_via_mcp\(/,
      "metadata.actor should be an agent_via_mcp(...) tag",
    );
    assert.ok(
      String(meta.actor).includes(adminUserId),
      "metadata.actor should reference the calling user id",
    );
    assert.ok(
      String(meta.actor).includes(patId),
      "metadata.actor should reference the calling PAT id",
    );
    assert.ok(
      String(meta.actor).includes("create_lead"),
      "metadata.actor should reference the tool name",
    );

    // --- resource read -----------------------------------------------------
    // The lead we just created is reachable as cadstone://lead/<id>. Reading
    // it through MCP exercises the resource template (the cadstone-entity
    // template registered in createCadstoneMcpServer) end-to-end and proves
    // the file/folder GET endpoints we just added are wired correctly for
    // the parser, even though we use a lead here so the test does not have
    // to set up the file-storage stack.
    const resource = await client.readResource({ uri: `cadstone://lead/${createdLead.id}` });
    assert.ok(
      Array.isArray(resource.contents) && resource.contents.length === 1,
      "resource read should return a single content item",
    );
    const resourceContent = resource.contents[0]!;
    assert.equal(
      resourceContent.uri,
      `cadstone://lead/${createdLead.id}`,
      "resource content should echo the requested URI",
    );
    assert.equal(resourceContent.mimeType, "application/json");
    const resourceJson = JSON.parse(String(resourceContent.text));
    const resourceLead = resourceJson.lead ?? resourceJson;
    assert.equal(
      resourceLead.id,
      createdLead.id,
      "resource read should return the same lead we created",
    );

    // --- stdio audit endpoint ---------------------------------------------
    // The stdio binary cannot share the in-process MCP_INTERNAL_SECRET, so
    // it audits each tool call by POSTing to /api/mcp/audit. We simulate the
    // stdio audit hook directly here so the test does not have to spawn a
    // subprocess.
    const { createStdioAuditHook } = await import("@workspace/mcp-server");
    const stdioHook = createStdioAuditHook(baseUrl, patSecret);
    const startedAt = new Date();
    await stdioHook({
      toolName: "list_jobs",
      startedAt,
      durationMs: 12,
      outcome: { ok: true, status: null },
    });

    const stdioAudit = await db
      .select({
        id: activityLog.id,
        userId: activityLog.userId,
        entityType: activityLog.entityType,
        entityId: activityLog.entityId,
        action: activityLog.action,
        metadata: activityLog.metadata,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityType, "mcp_tool_call"),
          eq(activityLog.action, "list_jobs"),
          eq(activityLog.userId, adminUserId),
        ),
      );
    // We expect at least 2 rows now: one from the in-process tool call above
    // and one written by the stdio audit endpoint we just hit.
    assert.ok(
      stdioAudit.length >= 2,
      `stdio audit POST should produce another mcp_tool_call row, got ${stdioAudit.length}`,
    );
    const stdioRow = stdioAudit[stdioAudit.length - 1]!;
    const stdioMeta = (stdioRow.metadata ?? {}) as Record<string, unknown>;
    assert.equal(stdioMeta.actorKind, "agent_via_mcp", "stdio audit metadata.actorKind");
    assert.equal(stdioMeta.toolName, "list_jobs", "stdio audit metadata.toolName");
    assert.equal(stdioMeta.patId, patId, "stdio audit metadata.patId");
    assert.equal(stdioMeta.ok, true, "stdio audit metadata.ok");
    assert.equal(stdioMeta.durationMs, 12, "stdio audit preserves durationMs from hook");
    assert.ok(
      String(stdioMeta.actor ?? "").includes("list_jobs"),
      "stdio audit actor tag should reference the tool name",
    );

    // The audit endpoint must reject unauthenticated callers. We send the
    // XHR header so we bypass the global CSRF gate and exercise the audit
    // route's own auth check (which returns 401 for missing/invalid PATs).
    const unauthed = await fetch(`${baseUrl}/api/mcp/audit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        toolName: "list_jobs",
        startedAt: new Date().toISOString(),
        durationMs: 1,
        ok: true,
      }),
    });
    assert.equal(unauthed.status, 401, "audit endpoint should reject missing PAT");

    // A bogus PAT (well-formed prefix but not in the database) must be 401.
    const badPat = await fetch(`${baseUrl}/api/mcp/audit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer cs_pat_${"x".repeat(40)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        toolName: "list_jobs",
        startedAt: new Date().toISOString(),
        durationMs: 1,
        ok: true,
      }),
    });
    assert.equal(badPat.status, 401, "audit endpoint should reject unknown PAT");
  } finally {
    await client.close().catch(() => {
      /* ignore */
    });
  }
});
