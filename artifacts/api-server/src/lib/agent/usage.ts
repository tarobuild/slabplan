import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { agentUsageMonthly } from "@workspace/db/schema";

/**
 * Per-user monthly token cap (input + output tokens combined).
 * Configurable via env; sensible default keeps individual users from
 * burning the workspace's Anthropic credits in a single afternoon.
 */
export const DEFAULT_AGENT_MONTHLY_TOKEN_CAP = 500_000;

export function monthlyTokenCap(): number {
  const raw = process.env.AGENT_MONTHLY_TOKEN_CAP;
  if (!raw) return DEFAULT_AGENT_MONTHLY_TOKEN_CAP;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return DEFAULT_AGENT_MONTHLY_TOKEN_CAP;
  return n;
}

/**
 * Org-wide monthly token budget — a global kill switch on top of the
 * per-user cap. Sized as a cost safety net: if a bug, a runaway loop, or
 * coordinated heavy use blows past per-user limits in aggregate, this
 * stops the bleeding before the Anthropic bill arrives.
 *
 * Default of 10M tokens = ~20× the per-user cap (500K), which comfortably
 * covers ~5 internal users hitting their cap simultaneously plus headroom
 * for a few months of growth, while still leaving a clear ceiling.
 * Configurable via `AGENT_MONTHLY_TOKEN_BUDGET`.
 */
export const DEFAULT_AGENT_MONTHLY_TOKEN_BUDGET = 10_000_000;

export function monthlyTokenBudget(): number {
  const raw = process.env.AGENT_MONTHLY_TOKEN_BUDGET;
  if (!raw) return DEFAULT_AGENT_MONTHLY_TOKEN_BUDGET;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return DEFAULT_AGENT_MONTHLY_TOKEN_BUDGET;
  return n;
}

export function currentYearMonth(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export type UsageSnapshot = {
  yearMonth: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  cap: number;
  remaining: number;
  exceeded: boolean;
};

export async function loadUsageSnapshot(
  userId: string,
  organizationId?: string | null,
): Promise<UsageSnapshot> {
  const ym = currentYearMonth();
  const cap = monthlyTokenCap();
  const [row] = await db
    .select()
    .from(agentUsageMonthly)
    .where(
      and(
        eq(agentUsageMonthly.userId, userId),
        eq(agentUsageMonthly.yearMonth, ym),
        organizationId
          ? eq(agentUsageMonthly.organizationId, organizationId)
          : isNull(agentUsageMonthly.organizationId),
      ),
    )
    .limit(1);
  const input = row?.inputTokens ?? 0;
  const output = row?.outputTokens ?? 0;
  const total = input + output;
  return {
    yearMonth: ym,
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    requests: row?.requests ?? 0,
    cap,
    remaining: Math.max(0, cap - total),
    exceeded: total >= cap,
  };
}

export type OrgUsageSnapshot = {
  yearMonth: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  budget: number;
  remaining: number;
  exceeded: boolean;
  userCount: number;
};

function usageIdentityCondition(
  userId: string,
  yearMonth: string,
  organizationId: string | null | undefined,
) {
  return and(
    eq(agentUsageMonthly.userId, userId),
    eq(agentUsageMonthly.yearMonth, yearMonth),
    organizationId
      ? eq(agentUsageMonthly.organizationId, organizationId)
      : isNull(agentUsageMonthly.organizationId),
  );
}

function isUniqueViolationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === "23505") return true;
  return (
    typeof candidate.cause === "object" &&
    candidate.cause !== null &&
    (candidate.cause as { code?: unknown }).code === "23505"
  );
}

async function incrementUsageRow(
  userId: string,
  organizationId: string | null | undefined,
  yearMonth: string,
  inputTokens: number,
  outputTokens: number,
): Promise<boolean> {
  const updated = await db
    .update(agentUsageMonthly)
    .set({
      inputTokens: sql`${agentUsageMonthly.inputTokens} + ${inputTokens}`,
      outputTokens: sql`${agentUsageMonthly.outputTokens} + ${outputTokens}`,
      requests: sql`${agentUsageMonthly.requests} + 1`,
      updatedAt: new Date(),
    })
    .where(usageIdentityCondition(userId, yearMonth, organizationId))
    .returning({ id: agentUsageMonthly.id });

  return updated.length > 0;
}

/**
 * Aggregate org-wide token usage for the current calendar month against
 * the configured budget. Reads from the same `agent_usage_monthly` table
 * the per-user snapshot uses — just summed across all users for the
 * current `year_month` bucket.
 */
export async function loadOrgUsageSnapshot(
  organizationId?: string | null,
): Promise<OrgUsageSnapshot> {
  const ym = currentYearMonth();
  const budget = monthlyTokenBudget();
  const [row] = await db
    .select({
      input: sql<number>`COALESCE(SUM(${agentUsageMonthly.inputTokens}), 0)::int`,
      output: sql<number>`COALESCE(SUM(${agentUsageMonthly.outputTokens}), 0)::int`,
      requests: sql<number>`COALESCE(SUM(${agentUsageMonthly.requests}), 0)::int`,
      userCount: sql<number>`COUNT(DISTINCT ${agentUsageMonthly.userId})::int`,
    })
    .from(agentUsageMonthly)
    .where(
      and(
        eq(agentUsageMonthly.yearMonth, ym),
        organizationId
          ? eq(agentUsageMonthly.organizationId, organizationId)
          : isNull(agentUsageMonthly.organizationId),
      ),
    );
  const input = row?.input ?? 0;
  const output = row?.output ?? 0;
  const total = input + output;
  return {
    yearMonth: ym,
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    requests: row?.requests ?? 0,
    budget,
    remaining: Math.max(0, budget - total),
    exceeded: total >= budget,
    userCount: row?.userCount ?? 0,
  };
}

export async function recordUsage(
  userId: string,
  organizationId: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const ym = currentYearMonth();
  if (await incrementUsageRow(userId, organizationId, ym, inputTokens, outputTokens)) {
    return;
  }

  try {
    await db.insert(agentUsageMonthly).values({
      organizationId: organizationId ?? null,
      userId,
      yearMonth: ym,
      inputTokens,
      outputTokens,
      requests: 1,
    });
  } catch (error) {
    if (!isUniqueViolationError(error)) throw error;
    const incremented = await incrementUsageRow(
      userId,
      organizationId,
      ym,
      inputTokens,
      outputTokens,
    );
    if (!incremented) throw error;
  }
}
