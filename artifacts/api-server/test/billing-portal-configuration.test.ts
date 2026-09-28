import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, mock, test } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import type Stripe from "stripe";

const organizationIds: string[] = [];
const created: Array<Record<string, unknown>> = [];
let server: Server;
let baseUrl: string;
let stripe: Stripe;
let organizationId: string;
let unboundOrganizationId: string;
let organizationRole = "owner";
let activeOrganization = "";

const PORTAL_ENV = ["STRIPE_PORTAL_CONFIGURATION_ID", "STRIPE_CUSTOMER_PORTAL_URL"] as const;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.STRIPE_SECRET_KEY = "sk_test_local_portal_fixture";
  process.env.APP_PUBLIC_URL = "https://app.example.test";

  const { db } = await import("@workspace/db");
  const { organizations } = await import("@workspace/db/schema");
  organizationId = randomUUID();
  unboundOrganizationId = randomUUID();
  organizationIds.push(organizationId, unboundOrganizationId);
  await db.insert(organizations).values([
    { id: organizationId, name: "TEST portal configuration", slug: `test-portal-${organizationId}`, stripeCustomerId: `cus_test_${organizationId.slice(0, 8)}` },
    { id: unboundOrganizationId, name: "TEST portal unbound", slug: `test-portal-${unboundOrganizationId}` },
  ]);

  const { getStripeClient } = await import("../src/lib/stripe.ts");
  stripe = getStripeClient();
  mock.method(stripe.billingPortal.sessions, "create", async (params: Record<string, unknown>) => {
    created.push(params);
    return { url: "https://billing.stripe.com/p/session/test_fixture", configuration: params.configuration ?? "bpc_default" };
  });

  const { default: billingRouter } = await import("../src/routes/billing.ts");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      userId: "00000000-0000-4000-8000-000000000001",
      email: "test-owner@example.test",
      role: organizationRole === "owner" ? "admin" : "crew_member",
      type: "access",
      organizationId: activeOrganization,
      organizationRole,
    } as never;
    next();
  });
  app.use("/billing", billingRouter);
  app.use((error: { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.statusCode ?? 500).json({ error: "rejected" });
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/billing`;
});

afterEach(() => {
  created.length = 0;
  organizationRole = "owner";
  activeOrganization = organizationId;
  for (const name of PORTAL_ENV) delete process.env[name];
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  const { db, pool } = await import("@workspace/db");
  const { organizations } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");
  try {
    await db.delete(organizations).where(inArray(organizations.id, organizationIds));
  } finally {
    await pool.end();
  }
});

async function openPortal() {
  activeOrganization ||= organizationId;
  const response = await fetch(`${baseUrl}/customer-portal-sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  return { status: response.status, body: (await response.json()) as { url?: string } };
}

test("a SlabPlan portal configuration reaches app-created, customer-bound sessions", async () => {
  process.env.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_SlabPlanTest123";
  process.env.STRIPE_CUSTOMER_PORTAL_URL = "https://billing.stripe.com/p/login/shared_default";
  const result = await openPortal();
  assert.equal(result.status, 201);
  assert.equal(result.body.url, "https://billing.stripe.com/p/session/test_fixture", "the shared static login link is not used");
  assert.deepEqual(created, [
    {
      customer: `cus_test_${organizationId.slice(0, 8)}`,
      return_url: "https://app.example.test/settings/billing",
      configuration: "bpc_SlabPlanTest123",
    },
  ]);
});

test("without a SlabPlan configuration the existing static link and default behavior are unchanged", async () => {
  process.env.STRIPE_CUSTOMER_PORTAL_URL = "https://billing.stripe.com/p/login/shared_default";
  const staticLink = await openPortal();
  assert.equal(staticLink.status, 201);
  assert.equal(staticLink.body.url, "https://billing.stripe.com/p/login/shared_default");
  assert.equal(created.length, 0);

  delete process.env.STRIPE_CUSTOMER_PORTAL_URL;
  const defaultSession = await openPortal();
  assert.equal(defaultSession.status, 201);
  assert.equal(created.length, 1);
  assert.equal("configuration" in created[0], false, "no configuration is sent unless SlabPlan's is set");
});

test("an invalid configuration id fails closed instead of falling back", async () => {
  for (const value of ["bpc", "bpc_bad value", "cus_123", "https://billing.stripe.com/p/login/x"]) {
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = value;
    process.env.STRIPE_CUSTOMER_PORTAL_URL = "https://billing.stripe.com/p/login/shared_default";
    const result = await openPortal();
    assert.equal(result.status, 503, value);
  }
  assert.equal(created.length, 0);
});

test("role and customer-binding checks still apply before any session is created", async () => {
  process.env.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_SlabPlanTest123";
  organizationRole = "member";
  assert.equal((await openPortal()).status, 403);
  organizationRole = "owner";
  activeOrganization = unboundOrganizationId;
  assert.equal((await openPortal()).status, 409);
  assert.equal(created.length, 0);
});
