import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:password@helium:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let adminAccessJwt: string;

const adminUserId = crypto.randomUUID();
const clientId = crypto.randomUUID();
const jobId = crypto.randomUUID();

let trackerId: string;
let areaId: string;
let lineItemA: string;
let lineItemB: string;

const adminEmail = `admin-${adminUserId}@financials-test.local`;

// Stub the anthropic client BEFORE importing the app so the route's
// `await anthropic.messages.create(...)` returns a deterministic
// response rather than calling out to the real API.
type AnthropicMessages = {
  create: (
    args: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
};
let nextEstimateJson: unknown = null;
let nextInvoiceJson: unknown = null;
let lastInvoiceCallSov: Array<{ id: string }> | null = null;
// When set, the very next anthropic.messages.create call throws this
// error and resets to null. Used by the AI failure-path log test
// below to drive callAnthropicWithLogging into its catch branch.
let nextAnthropicError: Error | null = null;

// Captures every structured log entry the route's AI wrapper emits via
// `logger.info({ event: "ai.estimate.parse" | "ai.invoice.parse", ... })`.
// Assertions in the test bodies below verify token + duration + jobId
// are present so we can answer "what's AI costing per feature?" and
// "which prompt class is failing right now?" from production logs.
const capturedAiLogs: Array<Record<string, unknown>> = [];

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://stub.invalid";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-key";
  process.env.SUPABASE_URL ??= "https://storage.example.invalid";
  process.env.SUPABASE_STORAGE_BUCKET ??= "cadstone-files";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

  const storageMod = await import("../src/lib/storage.ts");
  storageMod.__storageWriteTesting.setImpls({
    writeBuffer: async () => {},
    writeFromPath: async () => {},
  });

  // Patch the anthropic client with a stub.
  const anthropicMod = await import("@workspace/integrations-anthropic-ai");
  const stub: AnthropicMessages = {
    create: async (args: unknown) => {
      if (nextAnthropicError) {
        const e = nextAnthropicError;
        nextAnthropicError = null;
        throw e;
      }
      const body = args as {
        messages?: Array<{ content?: Array<{ type: string; text?: string }> }>;
      };
      const userText =
        body.messages?.[0]?.content?.find((c) => c.type === "text")?.text ?? "";
      // Distinguish estimate vs invoice prompts by content.
      if (userText.includes("Schedule of Values:")) {
        // Capture the SOV passed in so the test can build matches against
        // the real ids.
        const match = userText.match(
          /Schedule of Values:\s*(\[[\s\S]*?\])\s*\n/,
        );
        if (match) {
          try {
            lastInvoiceCallSov = JSON.parse(match[1]) as Array<{ id: string }>;
          } catch {
            lastInvoiceCallSov = null;
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify(nextInvoiceJson) }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(nextEstimateJson) }],
      };
    },
  };
  // anthropic.messages is the real surface area used by the route.
  (
    anthropicMod.anthropic as unknown as { messages: AnthropicMessages }
  ).messages = stub;

  // Patch the logger so the AI observability wrapper's structured log
  // entries can be asserted on. We only intercept entries tagged with
  // `event: "ai.*"`; everything else is dropped (LOG_LEVEL=silent).
  const loggerMod = await import("../src/lib/logger.ts");
  const realInfo = loggerMod.logger.info.bind(loggerMod.logger);
  const realWarn = loggerMod.logger.warn.bind(loggerMod.logger);
  const captureAiLog = (obj: unknown) => {
    if (
      obj &&
      typeof obj === "object" &&
      typeof (obj as Record<string, unknown>).event === "string"
    ) {
      const ev = (obj as Record<string, unknown>).event as string;
      if (ev.startsWith("ai."))
        capturedAiLogs.push(obj as Record<string, unknown>);
    }
  };
  (loggerMod.logger as unknown as { info: (...a: unknown[]) => void }).info = (
    ...args: unknown[]
  ) => {
    captureAiLog(args[0]);
    return realInfo(...(args as Parameters<typeof realInfo>));
  };
  // The AI observability wrapper logs failures via warn with
  // errorCode "AI_PARSE_FAILED" — mirror the same capture so the
  // failure-path test below can assert on the structured shape.
  (loggerMod.logger as unknown as { warn: (...a: unknown[]) => void }).warn = (
    ...args: unknown[]
  ) => {
    captureAiLog(args[0]);
    return realWarn(...(args as Parameters<typeof realWarn>));
  };

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const { users, jobs, clients } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Financials Admin",
    role: "admin",
  });

  await db.insert(clients).values({
    id: clientId,
    companyName: `ZZZ Financials Client ${clientId}`,
  });

  await db.insert(jobs).values({
    id: jobId,
    title: `ZZZ Financials Job ${jobId}`,
    clientId,
    createdBy: adminUserId,
    projectManagerId: adminUserId,
    contractValueCents: 100_000, // $1000 — should be IGNORED once tracker exists
    amountPaidCents: 50_000,
  });

  adminAccessJwt = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Financials Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { jobs, users, clients } = await import("@workspace/db/schema");
  const storageMod = await import("../src/lib/storage.ts");
  const { eq } = await import("drizzle-orm");
  try {
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(users).where(eq(users.id, adminUserId));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await pool.end();
    storageMod.__storageWriteTesting.reset();
  }
});

function authedHeaders(extra?: Record<string, string>) {
  return {
    authorization: `Bearer ${adminAccessJwt}`,
    "x-requested-with": "XMLHttpRequest",
    ...(extra ?? {}),
  };
}

function pdfMultipart(name: string, fields: Record<string, string> = {}) {
  // Minimal multipart/form-data body with a tiny "PDF" file. The route
  // sends the bytes to the (stubbed) anthropic client, so the real PDF
  // contents don't matter — only the multer wiring + mimetype check.
  const boundary = `----test${Math.random().toString(16).slice(2)}`;
  const fileBytes = Buffer.from("%PDF-1.4\n% stub\n%%EOF\n", "utf8");
  const fieldParts = Object.entries(fields).map(([key, value]) =>
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
        `${value}\r\n`,
      "utf8",
    ),
  );
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${name}"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([...fieldParts, head, fileBytes, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

test("GET /jobs/:id/financials lazily creates an empty tracker", async () => {
  const res = await fetch(`${baseUrl}/api/jobs/${jobId}/financials`, {
    headers: authedHeaders(),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    tracker: {
      id: string;
      retentionEnabled: boolean;
      retentionRateBps: number;
    };
    areas: unknown[];
    totals: {
      scheduledValueCents: number;
      billedCents: number;
      retention: {
        enabled: boolean;
        rateBps: number;
        netReceivedCents: number;
      };
    };
  };
  assert.ok(body.tracker.id, "tracker is created on first GET");
  trackerId = body.tracker.id;
  assert.equal(body.areas.length, 0);
  assert.equal(body.totals.scheduledValueCents, 0);
  assert.equal(body.totals.billedCents, 0);
  assert.equal(body.tracker.retentionEnabled, false);
  assert.equal(body.tracker.retentionRateBps, 1000);
  assert.equal(body.totals.retention.enabled, false);
  assert.equal(body.totals.retention.netReceivedCents, 0);
});

test("PATCH /financials toggles retention and stores custom rate", async () => {
  const res = await fetch(`${baseUrl}/api/jobs/${jobId}/financials`, {
    method: "PATCH",
    headers: authedHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ retentionEnabled: true, retentionRateBps: 1500 }),
  });
  const rawBody = await res.text();
  assert.equal(res.status, 200, rawBody);
  const body = JSON.parse(rawBody) as {
    tracker: { retentionEnabled: boolean; retentionRateBps: number };
  };
  assert.equal(body.tracker.retentionEnabled, true);
  assert.equal(body.tracker.retentionRateBps, 1500);
});

test("POST /financials/estimate parses AI response into SOV areas", async () => {
  nextEstimateJson = {
    projectName: "Test Project",
    contractDate: "2026-01-15",
    areas: [
      {
        name: "Kitchen",
        floor: "Floor 1",
        lineItems: [
          {
            description: "Quartz Slab A",
            qty: 1,
            rateCents: 200_000,
            scheduledValueCents: 200_000,
          },
          {
            description: "Quartz Slab B",
            qty: 2,
            rateCents: 150_000,
            scheduledValueCents: 300_000,
          },
        ],
      },
    ],
  };

  const m = pdfMultipart("estimate.pdf", {
    retentionEnabled: "true",
    retentionRateBps: "1000",
  });
  const res = await fetch(`${baseUrl}/api/jobs/${jobId}/financials/estimate`, {
    method: "POST",
    headers: authedHeaders(m.headers),
    body: m.body,
  });
  const rawBody = await res.text();
  assert.equal(res.status, 201, rawBody);
  const body = JSON.parse(rawBody) as {
    tracker: { retentionEnabled: boolean; retentionRateBps: number };
    areas: Array<{
      id: string;
      name: string;
      lineItems: Array<{ id: string; description: string }>;
    }>;
    totals: {
      scheduledValueCents: number;
      retention: {
        enabled: boolean;
        rateBps: number;
        maxRetentionCents: number;
      };
    };
  };
  assert.equal(body.tracker.retentionEnabled, true);
  assert.equal(body.tracker.retentionRateBps, 1000);
  assert.equal(body.areas.length, 1);
  assert.equal(body.areas[0].name, "Kitchen");
  assert.equal(body.areas[0].lineItems.length, 2);
  assert.equal(body.totals.scheduledValueCents, 500_000);
  assert.equal(body.totals.retention.enabled, true);
  assert.equal(body.totals.retention.rateBps, 1000);
  assert.equal(body.totals.retention.maxRetentionCents, 50_000);
  areaId = body.areas[0].id;
  lineItemA = body.areas[0].lineItems[0].id;
  lineItemB = body.areas[0].lineItems[1].id;
  assert.ok(areaId && lineItemA && lineItemB);

  // The AI observability wrapper must record one structured log entry
  // for the estimate parse with the exact field shape ops dashboards
  // are expected to consume.
  const estimateLog = capturedAiLogs.find(
    (l) => l.event === "ai.estimate.parse",
  );
  assert.ok(estimateLog, "expected an ai.estimate.parse log entry");
  assert.equal(estimateLog!.jobId, jobId);
  assert.equal(typeof estimateLog!.model, "string");
  assert.equal(typeof estimateLog!.promptTokens, "number");
  assert.equal(typeof estimateLog!.completionTokens, "number");
  assert.equal(typeof estimateLog!.totalTokens, "number");
  assert.equal(typeof estimateLog!.durationMs, "number");
});

test("POST /financials/invoices applies AI matches to line items", async () => {
  // Defer building the matches array until the test-time stub call sees
  // the SOV list. We pre-populate `nextInvoiceJson` with the ids the
  // estimate test created.
  nextInvoiceJson = {
    invoiceNumber: "INV-001",
    invoiceDate: "2026-02-01",
    totalCents: 250_000,
    retentionHeldCents: 25_000,
    netPaidCents: 225_000,
    matches: [
      { sovLineItemId: lineItemA, amountCents: 100_000 },
      { sovLineItemId: lineItemB, amountCents: 150_000 },
    ],
  };

  const m = pdfMultipart("invoice.pdf");
  const res = await fetch(`${baseUrl}/api/jobs/${jobId}/financials/invoices`, {
    method: "POST",
    headers: authedHeaders(m.headers),
    body: m.body,
  });
  const rawBody = await res.text();
  assert.equal(res.status, 201, rawBody);
  const body = JSON.parse(rawBody) as {
    totals: {
      billedCents: number;
      scheduledValueCents: number;
      percentBilled: number;
      retention: {
        retentionHeldCents: number;
        netReceivedCents: number;
        retentionOutstandingCents: number;
      };
    };
    invoices: Array<{
      id: string;
      invoiceNumber: string | null;
      appliedAt: string | null;
      retentionHeldCents: number;
      netPaidCents: number;
    }>;
  };
  assert.equal(body.totals.billedCents, 250_000);
  assert.equal(body.totals.scheduledValueCents, 500_000);
  assert.equal(body.totals.percentBilled, 50);
  assert.equal(body.totals.retention.retentionHeldCents, 25_000);
  assert.equal(body.totals.retention.netReceivedCents, 225_000);
  assert.equal(body.totals.retention.retentionOutstandingCents, 25_000);
  assert.equal(body.invoices.length, 1);
  assert.equal(body.invoices[0].invoiceNumber, "INV-001");
  assert.equal(body.invoices[0].retentionHeldCents, 25_000);
  assert.equal(body.invoices[0].netPaidCents, 225_000);
  assert.ok(body.invoices[0].appliedAt, "invoice should be marked applied");
  // Stub captured the SOV list passed to the AI prompt:
  assert.ok(
    lastInvoiceCallSov,
    "stub should have captured the SOV from the prompt",
  );
  assert.ok(lastInvoiceCallSov!.some((s) => s.id === lineItemA));

  // Same observability contract for invoice parses.
  const invoiceLog = capturedAiLogs.find((l) => l.event === "ai.invoice.parse");
  assert.ok(invoiceLog, "expected an ai.invoice.parse log entry");
  assert.equal(invoiceLog!.jobId, jobId);
  assert.equal(typeof invoiceLog!.model, "string");
  assert.equal(typeof invoiceLog!.promptTokens, "number");
  assert.equal(typeof invoiceLog!.completionTokens, "number");
  assert.equal(typeof invoiceLog!.totalTokens, "number");
  assert.equal(typeof invoiceLog!.durationMs, "number");
});

test("AI failure path logs structured warn entry with errorCode AI_PARSE_FAILED", async () => {
  // Force the next anthropic.messages.create call to throw. The
  // route's callAnthropicWithLogging wrapper should catch, emit a
  // structured warn log with the exact failure shape ops dashboards
  // alert on, then re-throw so the request returns 4xx/5xx.
  nextAnthropicError = new Error("upstream timed out reading PDF body");
  const before = capturedAiLogs.length;
  const m = pdfMultipart("estimate-fail.pdf");
  const res = await fetch(`${baseUrl}/api/jobs/${jobId}/financials/estimate`, {
    method: "POST",
    headers: authedHeaders(m.headers),
    body: m.body,
  });
  // The wrapper re-throws, so the route returns a non-2xx. We don't
  // pin the exact status — just assert the failure surfaced and the
  // log went out.
  assert.ok(res.status >= 400, `expected error status, got ${res.status}`);

  const failureLog = capturedAiLogs
    .slice(before)
    .find(
      (l) =>
        l.event === "ai.estimate.parse" && l.errorCode === "AI_PARSE_FAILED",
    );
  assert.ok(
    failureLog,
    "expected an ai.estimate.parse warn log with errorCode AI_PARSE_FAILED",
  );
  assert.equal(failureLog!.jobId, jobId);
  assert.equal(typeof failureLog!.model, "string");
  assert.equal(typeof failureLog!.durationMs, "number");
  assert.equal(typeof failureLog!.errorExcerpt, "string");
  // Sanitized excerpt is single-line and length-capped at 200.
  assert.ok(!String(failureLog!.errorExcerpt).includes("\n"));
  assert.ok(String(failureLog!.errorExcerpt).length <= 200);
  // The sanitized excerpt should preserve enough of the original
  // message to be diagnostic.
  assert.ok(String(failureLog!.errorExcerpt).includes("upstream timed out"));
});

test("DELETE /financials/invoices/:id reverses payments", async () => {
  // Find invoice id, then delete it.
  const r1 = await fetch(`${baseUrl}/api/jobs/${jobId}/financials`, {
    headers: authedHeaders(),
  });
  const before = (await r1.json()) as {
    invoices: Array<{ id: string }>;
    totals: { billedCents: number };
  };
  assert.equal(before.invoices.length, 1);
  assert.equal(before.totals.billedCents, 250_000);
  const invoiceId = before.invoices[0].id;

  const r2 = await fetch(
    `${baseUrl}/api/jobs/${jobId}/financials/invoices/${invoiceId}`,
    { method: "DELETE", headers: authedHeaders() },
  );
  assert.equal(r2.status, 200);

  const r3 = await fetch(`${baseUrl}/api/jobs/${jobId}/financials`, {
    headers: authedHeaders(),
  });
  const after = (await r3.json()) as {
    invoices: unknown[];
    totals: {
      billedCents: number;
      retention: { retentionHeldCents: number; netReceivedCents: number };
    };
  };
  assert.equal(after.invoices.length, 0);
  assert.equal(
    after.totals.billedCents,
    0,
    "deleting the invoice must reverse billed_cents",
  );
  assert.equal(after.totals.retention.retentionHeldCents, 0);
  assert.equal(after.totals.retention.netReceivedCents, 0);
});

test("GET /clients/:id rolls up tracker totals (not legacy job money fields)", async () => {
  // Re-apply payment so we have non-zero tracker totals to assert on.
  await fetch(
    `${baseUrl}/api/jobs/${jobId}/financials/line-items/${lineItemA}`,
    {
      method: "PATCH",
      headers: authedHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ percentComplete: 50 }),
    },
  );

  // Manually patch billed via re-running an invoice apply; simpler:
  // the tracker totals come from billed_cents, which we update via the
  // matches endpoint. Build a stub invoice row + apply matches.
  const m = pdfMultipart("invoice2.pdf");
  nextInvoiceJson = {
    invoiceNumber: "INV-002",
    invoiceDate: "2026-03-01",
    totalCents: 200_000,
    matches: [{ sovLineItemId: lineItemA, amountCents: 200_000 }],
  };
  const apply = await fetch(
    `${baseUrl}/api/jobs/${jobId}/financials/invoices`,
    {
      method: "POST",
      headers: authedHeaders(m.headers),
      body: m.body,
    },
  );
  assert.equal(apply.status, 201, await apply.text());

  const cRes = await fetch(`${baseUrl}/api/clients/${clientId}`, {
    headers: authedHeaders(),
  });
  assert.equal(cRes.status, 200);
  const c = (await cRes.json()) as {
    client: {
      jobs: Array<{
        id: string;
        contractValueCents: number;
        amountPaidCents: number;
        hasTracker: boolean;
      }>;
      rollups: { contractValueCents: number; amountPaidCents: number };
    };
  };
  const j = c.client.jobs.find((x) => x.id === jobId);
  assert.ok(j, "job should appear in client detail");
  assert.equal(j!.hasTracker, true, "job has a tracker");
  // Tracker contract = scheduled (500_000) + approved COs (0) = 500_000.
  // Should override the legacy job-level contractValueCents (100_000).
  assert.equal(j!.contractValueCents, 500_000);
  assert.equal(j!.amountPaidCents, 180_000);
  assert.equal(c.client.rollups.contractValueCents, 500_000);
  assert.equal(c.client.rollups.amountPaidCents, 180_000);
});

test("POST /financials/retention/release makes held retention count as received", async () => {
  const release = await fetch(
    `${baseUrl}/api/jobs/${jobId}/financials/retention/release`,
    {
      method: "POST",
      headers: authedHeaders(),
    },
  );
  const rawReleaseBody = await release.text();
  assert.equal(release.status, 200, rawReleaseBody);
  const released = JSON.parse(rawReleaseBody) as {
    tracker: { retentionReleasedAt: string | null };
    totals: {
      billedCents: number;
      retention: {
        released: boolean;
        netReceivedCents: number;
        retentionOutstandingCents: number;
      };
    };
  };
  assert.ok(released.tracker.retentionReleasedAt);
  assert.equal(released.totals.retention.released, true);
  assert.equal(
    released.totals.retention.netReceivedCents,
    released.totals.billedCents,
  );
  assert.equal(released.totals.retention.retentionOutstandingCents, 0);

  const cRes = await fetch(`${baseUrl}/api/clients/${clientId}`, {
    headers: authedHeaders(),
  });
  assert.equal(cRes.status, 200);
  const c = (await cRes.json()) as {
    client: {
      jobs: Array<{ id: string; amountPaidCents: number }>;
      rollups: { amountPaidCents: number };
    };
  };
  const j = c.client.jobs.find((x) => x.id === jobId);
  assert.ok(j, "job should appear in client detail");
  assert.equal(j!.amountPaidCents, 200_000);
  assert.equal(c.client.rollups.amountPaidCents, 200_000);
});

test("PATCH line-item scheduledValueCents preserves billed (caps only)", async () => {
  // Snapshot current billed for lineItemA via the financials GET.
  const before = await fetch(`${baseUrl}/api/jobs/${jobId}/financials`, {
    headers: authedHeaders(),
  }).then(
    (r) =>
      r.json() as Promise<{
        areas: Array<{
          lineItems: Array<{
            id: string;
            billedCents: number;
            scheduledValueCents: number;
            percentComplete: number;
          }>;
        }>;
      }>,
  );
  const liBefore = before.areas
    .flatMap((a) => a.lineItems)
    .find((li) => li.id === lineItemA);
  assert.ok(liBefore, "lineItemA should exist");
  const billedBefore = Number(liBefore!.billedCents);
  assert.ok(billedBefore > 0, "lineItemA should have a non-zero billed amount");

  // 1) Raising scheduled MUST NOT inflate billed.
  const grown = Number(liBefore!.scheduledValueCents) + 400_000;
  const r1 = await fetch(
    `${baseUrl}/api/jobs/${jobId}/financials/line-items/${lineItemA}`,
    {
      method: "PATCH",
      headers: authedHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ scheduledValueCents: grown }),
    },
  );
  const r1Text = await r1.text();
  assert.equal(r1.status, 200, r1Text);
  const after1 = JSON.parse(r1Text) as {
    lineItem: {
      billedCents: number;
      scheduledValueCents: number;
      percentComplete: string;
    };
  };
  assert.equal(
    Number(after1.lineItem.billedCents),
    billedBefore,
    "raising scheduled must not change billed",
  );
  assert.equal(Number(after1.lineItem.scheduledValueCents), grown);

  // 2) Lowering scheduled below billed MUST cap billed (and only cap).
  const cap = Math.floor(billedBefore / 2);
  const r2 = await fetch(
    `${baseUrl}/api/jobs/${jobId}/financials/line-items/${lineItemA}`,
    {
      method: "PATCH",
      headers: authedHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ scheduledValueCents: cap }),
    },
  );
  const r2Text = await r2.text();
  assert.equal(r2.status, 200, r2Text);
  const after2 = JSON.parse(r2Text) as {
    lineItem: { billedCents: number; scheduledValueCents: number };
  };
  assert.equal(
    Number(after2.lineItem.billedCents),
    cap,
    "lowering scheduled below billed must cap billed to the new scheduled",
  );
  assert.equal(Number(after2.lineItem.scheduledValueCents), cap);
});
