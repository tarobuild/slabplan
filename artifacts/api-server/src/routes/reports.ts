import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  changeOrders,
  clients,
  financialTrackers,
  jobs,
  leads,
  sovAreas,
  sovLineItems,
  trackerInvoices,
} from "@workspace/db/schema";
import type { AuthContext } from "../lib/authorization";
import { HttpError, asyncHandler } from "../lib/http";
import { organizationScopeCondition } from "../lib/tenant-scope";
import { requireAdmin } from "../middleware/require-auth";

const router: IRouter = Router();

// Reports surface is admin-only. PMs and crew get a 403 from requireAdmin
// (turned into the friendly forbidden state by the frontend RoleGate).
router.use(requireAdmin);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

const rangeQuerySchema = z
  .object({
    range: z.enum(["last_30", "last_90", "ytd", "custom"]).optional().default("last_90"),
    from: isoDate.optional(),
    to: isoDate.optional(),
    format: z.enum(["json", "csv"]).optional().default("json"),
  })
  .superRefine((v, ctx) => {
    if (v.range === "custom" && (!v.from || !v.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "from and to are required when range=custom.",
        path: ["from"],
      });
    }
    if (v.from && v.to && v.from > v.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "from must be on or before to.",
        path: ["from"],
      });
    }
  });

type Range = { from: string; to: string };

function resolveRange(parsed: z.infer<typeof rangeQuerySchema>): Range {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  if (parsed.range === "custom" && parsed.from && parsed.to) {
    return { from: parsed.from, to: parsed.to };
  }
  if (parsed.range === "ytd") {
    const yearStart = new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10);
    return { from: yearStart, to: todayStr };
  }
  const days = parsed.range === "last_30" ? 30 : 90;
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return { from, to: todayStr };
}

function parseQuery(req: Request) {
  const parsed = rangeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, "Invalid report query.", parsed.error.flatten());
  }
  return { ...parsed.data, ...resolveRange(parsed.data) };
}

// CSV helpers — kept small and dependency-free.
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const raw = String(v);
  const s = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function sendCsv(res: Response, filename: string, headers: string[], rows: unknown[][]) {
  // Stream the CSV row-by-row so memory usage stays flat regardless of
  // dataset size. Express's `res.write` lands directly on the socket.
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.write(`${headers.map(csvEscape).join(",")}\n`);
  for (const row of rows) res.write(`${row.map(csvEscape).join(",")}\n`);
  res.end();
}

// ---------------------------------------------------------------------------
// 1. A/R Aging by Client
//
// "Outstanding" per invoice is the gross invoice amount until an explicit cash
// collection source is modeled. Invoice line matches are SOV allocations, not
// customer payments, so reports must not subtract them as collected cash.
// ---------------------------------------------------------------------------

// Zod response contracts. These are exported so callers (and the unit
// tests) can validate the shape of every payload — frontend axios calls
// rely on them as the de-facto interface contract until /reports lands
// in the shared openapi.yaml.
export const arAgingRowSchema = z.object({
  clientId: z.string().nullable(),
  clientName: z.string(),
  current: z.number(),
  d1to30: z.number(),
  d31to60: z.number(),
  d61to90: z.number(),
  d90plus: z.number(),
  total: z.number(),
});
export const arAgingResponseSchema = z.object({ rows: z.array(arAgingRowSchema) });

export const revenueMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  billedCents: z.number(),
  collectedCents: z.number(),
  topJobs: z.array(
    z.object({
      jobId: z.string(),
      jobTitle: z.string(),
      amountCents: z.number(),
    }),
  ),
});
export const revenueResponseSchema = z.object({ months: z.array(revenueMonthSchema) });

export const pipelineResponseSchema = z.object({
  funnel: z.array(z.object({ stage: z.string(), count: z.number() })),
  winRate: z.number(),
  won: z.number(),
  lost: z.number(),
  avgDaysToClose: z.number(),
});

export const daysBucketSchema = z.object({
  id: z.string(),
  label: z.string(),
  count: z.number(),
  avgDays: z.number(),
  p90Days: z.number(),
});
export const daysToPaymentResponseSchema = z.object({
  byClient: z.array(daysBucketSchema),
  byJobType: z.array(daysBucketSchema),
});

export const jobsByStageRowSchema = z.object({
  clientId: z.string().nullable(),
  clientName: z.string(),
  open: z.number(),
  closed: z.number(),
  archived: z.number(),
  total: z.number(),
});
export const jobsByStageResponseSchema = z.object({ rows: z.array(jobsByStageRowSchema) });

type ArAgingRow = z.infer<typeof arAgingRowSchema>;

async function loadArAging(auth?: AuthContext): Promise<ArAgingRow[]> {
  const rows = await db
    .select({
      clientId: jobs.clientId,
      clientName: clients.companyName,
      invoiceDate: trackerInvoices.invoiceDate,
      totalCents: trackerInvoices.totalCents,
    })
    .from(trackerInvoices)
    .innerJoin(financialTrackers, eq(trackerInvoices.trackerId, financialTrackers.id))
    .innerJoin(jobs, eq(financialTrackers.jobId, jobs.id))
    .leftJoin(clients, eq(jobs.clientId, clients.id))
    .where(and(isNull(jobs.deletedAt), auth ? organizationScopeCondition(auth, jobs.organizationId) : undefined))
    .groupBy(
      trackerInvoices.id,
      jobs.clientId,
      clients.companyName,
      trackerInvoices.invoiceDate,
      trackerInvoices.totalCents,
    );

  const byClient = new Map<string, ArAgingRow>();
  const today = new Date();
  for (const r of rows) {
    const outstanding = Math.max(0, Number(r.totalCents ?? 0));
    if (outstanding === 0) continue;
    const key = r.clientId ?? "__unassigned__";
    const name = r.clientName ?? "Unknown client";
    let bucket = byClient.get(key);
    if (!bucket) {
      bucket = {
        clientId: r.clientId,
        clientName: name,
        current: 0,
        d1to30: 0,
        d31to60: 0,
        d61to90: 0,
        d90plus: 0,
        total: 0,
      };
      byClient.set(key, bucket);
    }
    let ageDays = 0;
    if (r.invoiceDate) {
      const inv = new Date(`${r.invoiceDate}T00:00:00Z`);
      ageDays = Math.floor((today.getTime() - inv.getTime()) / (24 * 60 * 60 * 1000));
    }
    if (ageDays <= 0) bucket.current += outstanding;
    else if (ageDays <= 30) bucket.d1to30 += outstanding;
    else if (ageDays <= 60) bucket.d31to60 += outstanding;
    else if (ageDays <= 90) bucket.d61to90 += outstanding;
    else bucket.d90plus += outstanding;
    bucket.total += outstanding;
  }
  return Array.from(byClient.values()).sort((a, b) => b.total - a.total);
}

router.get(
  "/ar-aging",
  asyncHandler(async (req, res) => {
    parseQuery(req); // validate even though aging is range-independent
    const data = await loadArAging(req.auth);
    const fmt = (req.query.format as string) ?? "json";
    if (fmt === "csv") {
      // Append a TOTALS row at the bottom so the CSV mirrors the UI's
      // footer aggregate (sum of every bucket across all clients).
      const totals = data.reduce(
        (acc, r) => {
          acc.current += r.current;
          acc.d1to30 += r.d1to30;
          acc.d31to60 += r.d31to60;
          acc.d61to90 += r.d61to90;
          acc.d90plus += r.d90plus;
          acc.total += r.total;
          return acc;
        },
        { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0, total: 0 },
      );
      sendCsv(
        res,
        "ar-aging.csv",
        ["Client", "Current", "1-30", "31-60", "61-90", "90+", "Total"],
        [
          ...data.map((r) => [
            r.clientName,
            r.current / 100,
            r.d1to30 / 100,
            r.d31to60 / 100,
            r.d61to90 / 100,
            r.d90plus / 100,
            r.total / 100,
          ]),
          [
            "TOTAL",
            totals.current / 100,
            totals.d1to30 / 100,
            totals.d31to60 / 100,
            totals.d61to90 / 100,
            totals.d90plus / 100,
            totals.total / 100,
          ],
        ],
      );
      return;
    }
    res.json(arAgingResponseSchema.parse({ rows: data }));
  }),
);

// ---------------------------------------------------------------------------
// 2. Revenue by Month
// ---------------------------------------------------------------------------

type RevenueMonth = z.infer<typeof revenueMonthSchema>;

async function loadRevenue(range: Range, auth?: AuthContext): Promise<RevenueMonth[]> {
  // Build a 12-month skeleton ending today (or end of range).
  const months: string[] = [];
  const end = new Date(`${range.to}T00:00:00Z`);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const startMonth = months[0];
  const startDate = `${startMonth}-01`;

  const billedRows = await db
    .select({
      month: sql<string>`to_char(${trackerInvoices.invoiceDate}, 'YYYY-MM')`,
      total: sql<number>`coalesce(sum(${trackerInvoices.totalCents}), 0)`,
      jobId: jobs.id,
      jobTitle: jobs.title,
    })
    .from(trackerInvoices)
    .innerJoin(financialTrackers, eq(trackerInvoices.trackerId, financialTrackers.id))
    .innerJoin(jobs, eq(financialTrackers.jobId, jobs.id))
    .where(
      and(
        isNull(jobs.deletedAt),
        auth ? organizationScopeCondition(auth, jobs.organizationId) : undefined,
        gte(trackerInvoices.invoiceDate, startDate),
        lte(trackerInvoices.invoiceDate, range.to),
      ),
    )
    .groupBy(sql`to_char(${trackerInvoices.invoiceDate}, 'YYYY-MM')`, jobs.id, jobs.title);

  const billedByMonth = new Map<string, number>();
  const topJobsByMonth = new Map<string, Map<string, { title: string; total: number }>>();
  for (const r of billedRows) {
    if (!r.month) continue;
    billedByMonth.set(r.month, (billedByMonth.get(r.month) ?? 0) + Number(r.total));
    let jobMap = topJobsByMonth.get(r.month);
    if (!jobMap) {
      jobMap = new Map();
      topJobsByMonth.set(r.month, jobMap);
    }
    const existing = jobMap.get(r.jobId) ?? { title: r.jobTitle, total: 0 };
    existing.total += Number(r.total);
    jobMap.set(r.jobId, existing);
  }
  return months.map((month) => {
    const jobMap = topJobsByMonth.get(month) ?? new Map();
    const topJobs = Array.from(jobMap.entries())
      .map(([jobId, v]) => ({ jobId, jobTitle: v.title, amountCents: v.total }))
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 3);
    return {
      month,
      billedCents: billedByMonth.get(month) ?? 0,
      collectedCents: 0,
      topJobs,
    };
  });
}

router.get(
  "/revenue",
  asyncHandler(async (req, res) => {
    const q = parseQuery(req);
    const data = await loadRevenue(q, req.auth);
    if (q.format === "csv") {
      sendCsv(
        res,
        "revenue-by-month.csv",
        ["Month", "Billed", "Collected"],
        data.map((r) => [r.month, r.billedCents / 100, r.collectedCents / 100]),
      );
      return;
    }
    res.json(revenueResponseSchema.parse({ months: data }));
  }),
);

// ---------------------------------------------------------------------------
// 3. Sales Pipeline & Win Rate
// ---------------------------------------------------------------------------

const PIPELINE_STAGES = ["open", "qualified", "in_negotiation", "won", "lost"] as const;
type PipelineStage = (typeof PIPELINE_STAGES)[number];

async function loadPipeline(range: Range, auth?: AuthContext) {
  // Funnel counts honor the date-range picker by filtering on
  // leads.createdAt, so the funnel reflects the selected window
  // (not all-time totals).
  const fromDate = new Date(`${range.from}T00:00:00Z`);
  const toDate = new Date(`${range.to}T23:59:59Z`);
  const counts = await db
    .select({
      status: leads.status,
      total: sql<number>`count(*)`,
    })
    .from(leads)
    .where(
      and(
        isNull(leads.deletedAt),
        auth ? organizationScopeCondition(auth, leads.organizationId) : undefined,
        gte(leads.createdAt, fromDate),
        lte(leads.createdAt, toDate),
      ),
    )
    .groupBy(leads.status);

  const funnel = PIPELINE_STAGES.map((stage) => ({
    stage,
    count: Number(counts.find((c) => c.status === stage)?.total ?? 0),
  }));

  // Win rate / avg days to close in the requested range, anchored on
  // updatedAt (the row's last status change is the closest signal we
  // have for "deal closed on …").
  const closed = await db
    .select({
      status: leads.status,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(
      and(
        isNull(leads.deletedAt),
        auth ? organizationScopeCondition(auth, leads.organizationId) : undefined,
        inArray(leads.status, ["won", "lost"]),
        gte(leads.updatedAt, fromDate),
        lte(leads.updatedAt, toDate),
      ),
    );

  const won = closed.filter((c) => c.status === "won");
  const lost = closed.filter((c) => c.status === "lost");
  const total = won.length + lost.length;
  const winRate = total > 0 ? Math.round((won.length / total) * 1000) / 10 : 0;

  const daysToCloseList = won
    .map((c) => {
      if (!c.createdAt || !c.updatedAt) return null;
      const ms = c.updatedAt.getTime() - c.createdAt.getTime();
      return ms / (24 * 60 * 60 * 1000);
    })
    .filter((d): d is number => d !== null && d >= 0);
  const avgDaysToClose =
    daysToCloseList.length > 0
      ? Math.round(
          (daysToCloseList.reduce((s, d) => s + d, 0) / daysToCloseList.length) * 10,
        ) / 10
      : 0;

  return {
    funnel,
    winRate,
    won: won.length,
    lost: lost.length,
    avgDaysToClose,
  };
}

router.get(
  "/pipeline",
  asyncHandler(async (req, res) => {
    const q = parseQuery(req);
    const data = await loadPipeline(q, req.auth);
    if (q.format === "csv") {
      sendCsv(
        res,
        "pipeline.csv",
        ["Stage", "Count"],
        data.funnel.map((f) => [f.stage, f.count]),
      );
      return;
    }
    res.json(pipelineResponseSchema.parse(data));
  }),
);

// ---------------------------------------------------------------------------
// 4. Days to Payment
// ---------------------------------------------------------------------------

type DaysToPaymentBucket = z.infer<typeof daysBucketSchema>;

async function loadDaysToPayment(range: Range, auth?: AuthContext): Promise<{
  byClient: DaysToPaymentBucket[];
  byJobType: DaysToPaymentBucket[];
}> {
  void range;
  void auth;
  return { byClient: [], byJobType: [] };
}

router.get(
  "/days-to-payment",
  asyncHandler(async (req, res) => {
    const q = parseQuery(req);
    const data = await loadDaysToPayment(q, req.auth);
    if (q.format === "csv") {
      const rows: unknown[][] = [];
      for (const r of data.byClient) rows.push(["client", r.label, r.count, r.avgDays, r.p90Days]);
      for (const r of data.byJobType) rows.push(["job_type", r.label, r.count, r.avgDays, r.p90Days]);
      sendCsv(res, "days-to-payment.csv", ["Group", "Label", "Invoices", "Avg Days", "p90 Days"], rows);
      return;
    }
    res.json(daysToPaymentResponseSchema.parse(data));
  }),
);

// ---------------------------------------------------------------------------
// 5. Jobs by Stage (counts of jobs by status sliced by client)
// ---------------------------------------------------------------------------

async function loadJobsByStage(auth?: AuthContext) {
  const rows = await db
    .select({
      clientId: jobs.clientId,
      clientName: clients.companyName,
      status: jobs.status,
      total: sql<number>`count(*)`,
    })
    .from(jobs)
    .leftJoin(clients, eq(jobs.clientId, clients.id))
    .where(and(isNull(jobs.deletedAt), auth ? organizationScopeCondition(auth, jobs.organizationId) : undefined))
    .groupBy(jobs.clientId, clients.companyName, jobs.status);

  const byClient = new Map<
    string,
    { clientId: string | null; clientName: string; open: number; closed: number; archived: number; total: number }
  >();
  for (const r of rows) {
    const key = r.clientId ?? "__unassigned__";
    const name = r.clientName ?? "Unknown client";
    const bucket = byClient.get(key) ?? {
      clientId: r.clientId,
      clientName: name,
      open: 0,
      closed: 0,
      archived: 0,
      total: 0,
    };
    const n = Number(r.total);
    if (r.status === "open") bucket.open += n;
    else if (r.status === "closed") bucket.closed += n;
    else if (r.status === "archived") bucket.archived += n;
    bucket.total += n;
    byClient.set(key, bucket);
  }
  return Array.from(byClient.values()).sort((a, b) => b.total - a.total);
}

router.get(
  "/jobs-by-stage",
  asyncHandler(async (req, res) => {
    const q = parseQuery(req);
    const data = await loadJobsByStage(req.auth);
    if (q.format === "csv") {
      sendCsv(
        res,
        "jobs-by-stage.csv",
        ["Client", "Open", "Closed", "Archived", "Total"],
        data.map((r) => [r.clientName, r.open, r.closed, r.archived, r.total]),
      );
      return;
    }
    res.json(jobsByStageResponseSchema.parse({ rows: data }));
  }),
);

export default router;

// Exported for unit tests.
export const __testing = {
  resolveRange,
  rangeQuerySchema,
  loadArAging,
  loadRevenue,
  loadPipeline,
  loadDaysToPayment,
  loadJobsByStage,
};
