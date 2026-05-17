import { and, count, desc, eq, gte, inArray, isNull, lte, lt, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  changeOrders,
  clients,
  dailyLogs,
  financialTrackers,
  invoiceLinePayments,
  jobs,
  leads,
  scheduleItemAssignees,
  scheduleItemTodos,
  scheduleItems,
  sovAreas,
  sovLineItems,
  trackerInvoices,
  users,
} from "@workspace/db/schema";
import {
  isAdmin,
  listAccessibleJobIds,
  listAccessibleLeadIds,
} from "../lib/authorization";
import {
  isChangeOrderPending,
  isInvoicePastDue,
  isScheduleItemOverdue,
  jobsMissingDailyLogs,
} from "../lib/at-risk";
import { buildDailyLogVisibilityFilter } from "../lib/daily-log-visibility";
import { HttpError, asyncHandler } from "../lib/http";
import { buildScheduleListVisibilityFilter } from "../lib/schedule-visibility";
import { organizationScopeCondition } from "../lib/tenant-scope";
import { getCachedForecastForAddress, type WeatherSnapshot } from "../lib/weather";

const router: IRouter = Router();

// YYYY-MM-DD date strings only. We accept the same shape Postgres accepts for
// `date` columns and reject anything else with a 400 — otherwise malformed
// values reach Drizzle/Postgres and either crash with a cast error or
// silently widen the requested range.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    // Round-trip catches things like 2025-02-30 that the Date constructor
    // happily coerces to a different day.
    return parsed.toISOString().slice(0, 10) === value;
  }, "Date must be a real calendar date in YYYY-MM-DD format.");

export const dashboardScheduleQuerySchema = z
  .object({
    start: isoDate.optional(),
    end: isoDate.optional(),
    clientId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.start && value.end && value.start > value.end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`start` must be on or before `end`.",
        path: ["start"],
      });
    }
  });

router.get(
  "/dashboard/stats",
  asyncHandler(async (req, res) => {
    const [accessibleJobIds, accessibleLeadIds] = await Promise.all([
      listAccessibleJobIds(req.auth!),
      listAccessibleLeadIds(req.auth!),
    ]);

    if (accessibleJobIds && accessibleJobIds.length === 0) {
      res.json({
        stats: {
          activeJobs: 0,
          openLeads: 0,
          openScheduleItems: 0,
          myDailyLogs: 0,
        },
      });
      return;
    }

    const [activeJobsRow, openLeadsRow, openScheduleItemsRow, myDailyLogsRow] =
      await Promise.all([
        db
          .select({ total: count() })
          .from(jobs)
          .where(
            and(
              isNull(jobs.deletedAt),
              organizationScopeCondition(req.auth!, jobs.organizationId),
              eq(jobs.status, "open"),
              accessibleJobIds ? inArray(jobs.id, accessibleJobIds) : undefined,
            ),
          )
          .then((rows) => rows[0]),
        db
          .select({ total: count() })
          .from(leads)
          .where(
            and(
              isNull(leads.deletedAt),
              organizationScopeCondition(req.auth!, leads.organizationId),
              inArray(leads.status, ["open", "in_negotiation"]),
              accessibleLeadIds ? inArray(leads.id, accessibleLeadIds) : undefined,
            ),
          )
          .then((rows) => rows[0]),
        db
          .select({ total: count() })
          .from(scheduleItems)
          .where(
            and(
              isNull(scheduleItems.deletedAt),
              organizationScopeCondition(req.auth!, scheduleItems.organizationId),
              or(isNull(scheduleItems.progress), lt(scheduleItems.progress, 100)),
              accessibleJobIds ? inArray(scheduleItems.jobId, accessibleJobIds) : undefined,
              buildScheduleListVisibilityFilter(req.auth!),
            ),
          )
          .then((rows) => rows[0]),
        db
          .select({ total: count() })
          .from(dailyLogs)
          .where(
            and(
              isNull(dailyLogs.deletedAt),
              organizationScopeCondition(req.auth!, dailyLogs.organizationId),
              eq(dailyLogs.createdBy, req.auth!.userId),
              accessibleJobIds ? inArray(dailyLogs.jobId, accessibleJobIds) : undefined,
            ),
          )
          .then((rows) => rows[0]),
      ]);

    res.json({
      stats: {
        activeJobs: Number(activeJobsRow?.total ?? 0),
        openLeads: Number(openLeadsRow?.total ?? 0),
        openScheduleItems: Number(openScheduleItemsRow?.total ?? 0),
        myDailyLogs: Number(myDailyLogsRow?.total ?? 0),
      },
    });
  }),
);

router.get(
  "/dashboard/agenda",
  asyncHandler(async (req, res) => {
    const accessibleJobIds = await listAccessibleJobIds(req.auth!);
    const today = new Date().toISOString().split("T")[0];
    const in14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    if (accessibleJobIds && accessibleJobIds.length === 0) {
      res.json({ upcomingItems: [], recentLogs: [], recentJobs: [] });
      return;
    }

    const scheduleVisibilityFilter = buildScheduleListVisibilityFilter(req.auth!);
    const dailyLogVisibilityFilter = buildDailyLogVisibilityFilter(req.auth!);

    const [upcomingItems, recentLogs, recentJobs] = await Promise.all([
      db
        .select({
          id: scheduleItems.id,
          title: scheduleItems.title,
          startDate: scheduleItems.startDate,
          endDate: scheduleItems.endDate,
          displayColor: scheduleItems.displayColor,
          isComplete: scheduleItems.isComplete,
          progress: scheduleItems.progress,
          jobId: scheduleItems.jobId,
          jobTitle: jobs.title,
        })
        .from(scheduleItems)
        .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
        .where(
          and(
            isNull(scheduleItems.deletedAt),
            organizationScopeCondition(req.auth!, scheduleItems.organizationId),
            gte(scheduleItems.startDate, today),
            lte(scheduleItems.startDate, in14Days),
            or(isNull(scheduleItems.isComplete), eq(scheduleItems.isComplete, false)),
            accessibleJobIds ? inArray(scheduleItems.jobId, accessibleJobIds) : undefined,
            scheduleVisibilityFilter,
          ),
        )
        .orderBy(scheduleItems.startDate)
        .limit(10),

      db
        .select({
          id: dailyLogs.id,
          logDate: dailyLogs.logDate,
          title: dailyLogs.title,
          notes: dailyLogs.notes,
          jobId: dailyLogs.jobId,
          jobTitle: jobs.title,
          createdByName: users.fullName,
        })
        .from(dailyLogs)
        .leftJoin(jobs, eq(dailyLogs.jobId, jobs.id))
        .leftJoin(users, eq(dailyLogs.createdBy, users.id))
        .where(
          and(
            isNull(dailyLogs.deletedAt),
            organizationScopeCondition(req.auth!, dailyLogs.organizationId),
            accessibleJobIds ? inArray(dailyLogs.jobId, accessibleJobIds) : undefined,
            dailyLogVisibilityFilter,
          ),
        )
        .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.createdAt))
        .limit(5),

      db
        .select({
          id: jobs.id,
          title: jobs.title,
          status: jobs.status,
          city: jobs.city,
          state: jobs.state,
          createdAt: jobs.createdAt,
        })
        .from(jobs)
        .where(
          and(
            isNull(jobs.deletedAt),
            organizationScopeCondition(req.auth!, jobs.organizationId),
            eq(jobs.status, "open"),
            accessibleJobIds ? inArray(jobs.id, accessibleJobIds) : undefined,
          ),
        )
        .orderBy(desc(jobs.createdAt))
        .limit(5),
    ]);

    res.json({ upcomingItems, recentLogs, recentJobs });
  }),
);

router.get(
  "/dashboard/schedule",
  asyncHandler(async (req, res) => {
    const parsed = dashboardScheduleQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(
        400,
        "Invalid dashboard schedule query.",
        parsed.error.flatten(),
      );
    }

    const accessibleJobIds = await listAccessibleJobIds(req.auth!);
    const startParam =
      parsed.data.start ?? new Date().toISOString().split("T")[0];
    const endParam =
      parsed.data.end ??
      new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
    const clientFilter = parsed.data.clientId
      ? eq(jobs.clientId, parsed.data.clientId)
      : undefined;

    if (accessibleJobIds && accessibleJobIds.length === 0) {
      res.json({ items: [] });
      return;
    }

    const scheduleVisibilityFilter = buildScheduleListVisibilityFilter(req.auth!);

    const scheduleItemRows = await db
      .select({
        id: scheduleItems.id,
        title: scheduleItems.title,
        startDate: scheduleItems.startDate,
        endDate: scheduleItems.endDate,
        workDays: scheduleItems.workDays,
        displayColor: scheduleItems.displayColor,
        progress: scheduleItems.progress,
        isComplete: scheduleItems.isComplete,
        jobId: scheduleItems.jobId,
        jobTitle: jobs.title,
        jobCity: jobs.city,
        jobState: jobs.state,
      })
      .from(scheduleItems)
      .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
      .where(
        and(
          isNull(scheduleItems.deletedAt),
          isNull(jobs.deletedAt),
          organizationScopeCondition(req.auth!, scheduleItems.organizationId),
          organizationScopeCondition(req.auth!, jobs.organizationId),
          accessibleJobIds ? inArray(scheduleItems.jobId, accessibleJobIds) : undefined,
          clientFilter,
          // items that overlap the requested range
          lte(scheduleItems.startDate, endParam),
          or(
            gte(scheduleItems.endDate, startParam),
            gte(scheduleItems.startDate, startParam),
          ),
          scheduleVisibilityFilter,
        ),
      )
      .orderBy(scheduleItems.startDate)
      .limit(500);

    // Also include jobs themselves as calendar items so a freshly created job
    // with projected/actual dates shows up immediately on the home calendar
    // (before any schedule items have been added to it). A job uses
    // actualStart/actualCompletion if both are set, otherwise it falls back to
    // projectedStart/projectedCompletion. A single date (start only, no end)
    // is rendered as a one-day pin on its start date.
    const jobRows = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        status: jobs.status,
        projectedStart: jobs.projectedStart,
        projectedCompletion: jobs.projectedCompletion,
        actualStart: jobs.actualStart,
        actualCompletion: jobs.actualCompletion,
        city: jobs.city,
        state: jobs.state,
      })
      .from(jobs)
      .where(
        and(
          isNull(jobs.deletedAt),
          organizationScopeCondition(req.auth!, jobs.organizationId),
          accessibleJobIds ? inArray(jobs.id, accessibleJobIds) : undefined,
          clientFilter,
          // The job has at least one date that lets it appear on the calendar.
          or(
            sql`${jobs.actualStart} is not null`,
            sql`${jobs.projectedStart} is not null`,
          ),
          // SQL-level date-range overlap. effectiveStart = coalesce(actual_start, projected_start).
          // effectiveEnd = coalesce(actual_completion when actual_start is set,
          //                         projected_completion otherwise, effectiveStart).
          sql`coalesce(${jobs.actualStart}, ${jobs.projectedStart}) <= ${endParam}`,
          sql`coalesce(
            case when ${jobs.actualStart} is not null then ${jobs.actualCompletion}
                 else ${jobs.projectedCompletion}
            end,
            ${jobs.actualStart},
            ${jobs.projectedStart}
          ) >= ${startParam}`,
        ),
      )
      .limit(500);

    const jobItems = jobRows
      .map((job) => {
        const start = job.actualStart ?? job.projectedStart;
        if (!start) return null;
        const end =
          (job.actualStart ? job.actualCompletion : job.projectedCompletion) ??
          start;
        // Range-overlap filter applied in JS because two distinct date pairs
        // (projected vs actual) collapse into one effective pair per job above.
        if (start > endParam) return null;
        if (end < startParam) return null;
        return {
          id: `job:${job.id}`,
          kind: "job" as const,
          title: job.title,
          startDate: start,
          endDate: end,
          workDays: null,
          displayColor: "#475569", // slate-600 — visually distinct from schedule items
          progress: null,
          isComplete: job.status === "closed" || job.status === "archived",
          jobId: job.id,
          jobTitle: job.title,
          jobCity: job.city,
          jobState: job.state,
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

    const items = [
      ...scheduleItemRows.map((row) => ({ ...row, kind: "schedule_item" as const })),
      ...jobItems,
    ].sort((a, b) => a.startDate.localeCompare(b.startDate));

    res.json({ items });
  }),
);

// ---------------------------------------------------------------------------
// Role-aware Home page (Task #321) — single endpoint, branches by role.
//
// One endpoint returns a discriminated union keyed by `role`. We picked the
// single-endpoint shape so the Home page renders from one network call —
// the alternative (one endpoint per role) would have introduced three
// nearly-identical OpenAPI entries and three React Query hooks for what is
// fundamentally one screen with three layouts.
// ---------------------------------------------------------------------------

const PM_AT_RISK_NO_LOG_WORKING_DAYS = 3;
const ADMIN_TOP_CLIENTS_LIMIT = 5;
const ADMIN_RECENT_LEADS_LIMIT = 5;
const PM_TEAM_LOG_WINDOW_HOURS = 24;
// Cap on the per-cohort drill-down list returned in `samples`. Set high
// enough that the PM Home at-risk tiles can drill into the full counted
// set in any realistic workspace (a workspace carrying 500+ overdue
// schedule items, jobs missing logs, or pending change orders has
// bigger problems than this list cap). The drill-down pages render
// these straight from /dashboard/home rather than hitting separate
// list endpoints.
const PM_AT_RISK_DRILLDOWN_LIMIT = 500;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function startOfThisWeekIso(today: string): string {
  // ISO week starts on Monday — matches scheduling/calendar conventions
  // already in use across the schedule UI.
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0..6 (Sun..Sat)
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function endOfThisWeekIso(today: string): string {
  const start = new Date(`${startOfThisWeekIso(today)}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 6);
  return start.toISOString().slice(0, 10);
}

function startOfMonthIso(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

type CrewScheduleRow = {
  jobId: string;
  jobTitle: string | null;
  jobCity: string | null;
  jobState: string | null;
  jobAddress: string | null;
};

type CrewLatestLogRow = {
  jobId: string;
  jobTitle: string | null;
} | null;

type CrewForecastJob = {
  jobId: string;
  jobTitle: string | null;
  address: string;
} | null;

function buildJobAddress(row: {
  jobAddress?: string | null;
  jobCity?: string | null;
  jobState?: string | null;
}): string {
  return [row.jobAddress, row.jobCity, row.jobState]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join(", ");
}

function pickPrimaryJobForForecast(
  schedule: CrewScheduleRow[],
  latestLog: CrewLatestLogRow,
): CrewForecastJob {
  for (const row of schedule) {
    const address = buildJobAddress(row);
    if (address.length > 0) {
      return { jobId: row.jobId, jobTitle: row.jobTitle, address };
    }
  }
  if (latestLog) {
    // We didn't query the latest log's address columns; fall back to the job
    // title (which is often a city or site name) so the geocoder still has
    // something to work with.
    const fallback = (latestLog.jobTitle ?? "").trim();
    if (fallback.length > 0) {
      return { jobId: latestLog.jobId, jobTitle: latestLog.jobTitle, address: fallback };
    }
  }
  return null;
}

async function fetchForecastForJob(job: CrewForecastJob): Promise<
  | (WeatherSnapshot & { jobId: string; jobTitle: string | null; address: string })
  | null
> {
  if (!job) return null;
  const snap = await getCachedForecastForAddress(job.address);
  if (!snap) return null;
  return { ...snap, jobId: job.jobId, jobTitle: job.jobTitle, address: job.address };
}

async function buildCrewHome(auth: NonNullable<Express.Request["auth"]>) {
  const today = todayIso();
  const userId = auth.userId;

  // Today's schedule items assigned to me. We restrict to items whose date
  // window contains today so a freshly-scheduled multi-day install still
  // shows up while it's in progress.
  const myAssignedTodayPromise = db
    .select({
      id: scheduleItems.id,
      title: scheduleItems.title,
      startDate: scheduleItems.startDate,
      endDate: scheduleItems.endDate,
      startTime: scheduleItems.startTime,
      endTime: scheduleItems.endTime,
      displayColor: scheduleItems.displayColor,
      progress: scheduleItems.progress,
      isComplete: scheduleItems.isComplete,
      jobId: scheduleItems.jobId,
      jobTitle: jobs.title,
      jobCity: jobs.city,
      jobState: jobs.state,
      jobAddress: jobs.streetAddress,
    })
    .from(scheduleItems)
    .innerJoin(scheduleItemAssignees, eq(scheduleItemAssignees.scheduleItemId, scheduleItems.id))
    .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
    .where(
      and(
        eq(scheduleItemAssignees.userId, userId),
        isNull(scheduleItems.deletedAt),
        isNull(jobs.deletedAt),
        lte(scheduleItems.startDate, today),
        gte(scheduleItems.endDate, today),
      ),
    )
    .orderBy(scheduleItems.startTime, scheduleItems.startDate);

  // The most recent daily log I authored — used for the weather strip and
  // a quick "continue editing" affordance.
  const myLatestLogPromise = db
    .select({
      id: dailyLogs.id,
      logDate: dailyLogs.logDate,
      jobId: dailyLogs.jobId,
      jobTitle: jobs.title,
      title: dailyLogs.title,
      weatherData: dailyLogs.weatherData,
      weatherNotes: dailyLogs.weatherNotes,
      includeWeather: dailyLogs.includeWeather,
    })
    .from(dailyLogs)
    .leftJoin(jobs, eq(dailyLogs.jobId, jobs.id))
    .where(and(eq(dailyLogs.createdBy, userId), isNull(dailyLogs.deletedAt)))
    .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.createdAt))
    .limit(1);

  // My open todos across schedule items I'm assigned to or that I created.
  const myTodosPromise = db
    .select({
      id: scheduleItemTodos.id,
      title: scheduleItemTodos.title,
      isComplete: scheduleItemTodos.isComplete,
      scheduleItemId: scheduleItemTodos.scheduleItemId,
      scheduleItemTitle: scheduleItems.title,
      jobId: scheduleItems.jobId,
      jobTitle: jobs.title,
    })
    .from(scheduleItemTodos)
    .innerJoin(scheduleItems, eq(scheduleItemTodos.scheduleItemId, scheduleItems.id))
    .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
    .leftJoin(
      scheduleItemAssignees,
      and(
        eq(scheduleItemAssignees.scheduleItemId, scheduleItems.id),
        eq(scheduleItemAssignees.userId, userId),
      ),
    )
    .where(
      and(
        or(eq(scheduleItemTodos.isComplete, false), isNull(scheduleItemTodos.isComplete)),
        isNull(scheduleItems.deletedAt),
        or(
          eq(scheduleItemTodos.createdBy, userId),
          sql`${scheduleItemAssignees.userId} is not null`,
        ),
      ),
    )
    .orderBy(desc(scheduleItemTodos.createdAt))
    .limit(20);

  const [myAssignedToday, myLatestLogRows, myTodos] = await Promise.all([
    myAssignedTodayPromise,
    myLatestLogPromise,
    myTodosPromise,
  ]);

  const latestLog = myLatestLogRows[0] ?? null;

  // Pick today's primary job for the weather forecast: the first scheduled
  // item assigned to this crew member, falling back to the most recent daily
  // log's job. Forecasts are cached server-side for an hour, so this stays
  // cheap even when many crew members hit /dashboard/home in the morning.
  const primaryJob = pickPrimaryJobForForecast(myAssignedToday, latestLog);
  const forecast = await fetchForecastForJob(primaryJob);

  return {
    role: "crew" as const,
    today,
    schedule: {
      items: myAssignedToday.map((row) => ({
        ...row,
        progress: row.progress ?? 0,
        isComplete: row.isComplete === true,
      })),
    },
    todos: myTodos.map((row) => ({
      ...row,
      isComplete: row.isComplete === true,
    })),
    forecast,
    weather:
      latestLog && latestLog.includeWeather !== false
        ? {
            jobId: latestLog.jobId,
            jobTitle: latestLog.jobTitle,
            logDate: latestLog.logDate,
            weatherData: latestLog.weatherData ?? null,
            weatherNotes: latestLog.weatherNotes ?? null,
          }
        : null,
    latestLog: latestLog
      ? {
          id: latestLog.id,
          logDate: latestLog.logDate,
          jobId: latestLog.jobId,
          jobTitle: latestLog.jobTitle,
          title: latestLog.title,
        }
      : null,
  };
}

async function buildPmHome(auth: NonNullable<Express.Request["auth"]>) {
  const today = todayIso();
  const weekStart = startOfThisWeekIso(today);
  const weekEnd = endOfThisWeekIso(today);

  const [accessibleJobIds, accessibleLeadIds] = await Promise.all([
    listAccessibleJobIds(auth),
    listAccessibleLeadIds(auth),
  ]);
  if (accessibleJobIds && accessibleJobIds.length === 0) {
    return {
      role: "pm" as const,
      today,
      week: { start: weekStart, end: weekEnd, items: [] },
      atRisk: { overdueScheduleItems: 0, jobsMissingLogs: 0, pendingChangeOrders: 0, samples: [] },
      teamLogs: [],
      summary: { activeJobs: 0, openLeads: 0, openScheduleItems: 0 },
    };
  }

  const jobIdFilter = (col: typeof scheduleItems.jobId | typeof dailyLogs.jobId) =>
    accessibleJobIds ? inArray(col, accessibleJobIds) : undefined;

  const scheduleVisibilityFilter = buildScheduleListVisibilityFilter(auth);
  const dailyLogVisibilityFilter = buildDailyLogVisibilityFilter(auth);

  // This-week schedule items overlapping the Mon-Sun window.
  const weekItemsPromise = db
    .select({
      id: scheduleItems.id,
      title: scheduleItems.title,
      startDate: scheduleItems.startDate,
      endDate: scheduleItems.endDate,
      progress: scheduleItems.progress,
      isComplete: scheduleItems.isComplete,
      displayColor: scheduleItems.displayColor,
      jobId: scheduleItems.jobId,
      jobTitle: jobs.title,
    })
    .from(scheduleItems)
    .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
    .where(
      and(
        isNull(scheduleItems.deletedAt),
        isNull(jobs.deletedAt),
        jobIdFilter(scheduleItems.jobId),
        lte(scheduleItems.startDate, weekEnd),
        gte(scheduleItems.endDate, weekStart),
        scheduleVisibilityFilter,
      ),
    )
    .orderBy(scheduleItems.startDate)
    .limit(200);

  // Overdue schedule items: end date before today, not complete.
  const overdueRowsPromise = db
    .select({
      id: scheduleItems.id,
      title: scheduleItems.title,
      endDate: scheduleItems.endDate,
      progress: scheduleItems.progress,
      isComplete: scheduleItems.isComplete,
      jobId: scheduleItems.jobId,
      jobTitle: jobs.title,
    })
    .from(scheduleItems)
    .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
    .where(
      and(
        isNull(scheduleItems.deletedAt),
        isNull(jobs.deletedAt),
        jobIdFilter(scheduleItems.jobId),
        lt(scheduleItems.endDate, today),
        or(isNull(scheduleItems.isComplete), eq(scheduleItems.isComplete, false)),
        scheduleVisibilityFilter,
      ),
    )
    .orderBy(scheduleItems.endDate)
    .limit(PM_AT_RISK_DRILLDOWN_LIMIT);

  // Last log per accessible open job — used to flag jobs that have gone
  // dark for >= N working days.
  const lastLogPerJobPromise = db
    .select({
      jobId: dailyLogs.jobId,
      lastLogDate: sql<string>`max(${dailyLogs.logDate})`,
    })
    .from(dailyLogs)
    .where(
      and(
        isNull(dailyLogs.deletedAt),
        jobIdFilter(dailyLogs.jobId),
      ),
    )
    .groupBy(dailyLogs.jobId);

  const openJobsPromise = db
    .select({ id: jobs.id, title: jobs.title })
    .from(jobs)
    .where(
      and(
        isNull(jobs.deletedAt),
        eq(jobs.status, "open"),
        accessibleJobIds ? inArray(jobs.id, accessibleJobIds) : undefined,
      ),
    );

  // Pending change orders across accessible jobs.
  const pendingCosPromise = db
    .select({
      id: changeOrders.id,
      number: changeOrders.number,
      amountCents: changeOrders.amountCents,
      status: changeOrders.status,
      trackerId: changeOrders.trackerId,
      jobId: financialTrackers.jobId,
      jobTitle: jobs.title,
    })
    .from(changeOrders)
    .innerJoin(financialTrackers, eq(changeOrders.trackerId, financialTrackers.id))
    .innerJoin(jobs, eq(financialTrackers.jobId, jobs.id))
    .where(
      and(
        isNull(jobs.deletedAt),
        accessibleJobIds ? inArray(financialTrackers.jobId, accessibleJobIds) : undefined,
        eq(changeOrders.status, "pending"),
      ),
    )
    .orderBy(desc(changeOrders.createdAt))
    .limit(PM_AT_RISK_DRILLDOWN_LIMIT);

  // Team daily logs in the last 24h (visibility-filtered).
  const since = new Date(Date.now() - PM_TEAM_LOG_WINDOW_HOURS * 60 * 60 * 1000);
  const teamLogsPromise = db
    .select({
      id: dailyLogs.id,
      logDate: dailyLogs.logDate,
      title: dailyLogs.title,
      notes: dailyLogs.notes,
      jobId: dailyLogs.jobId,
      jobTitle: jobs.title,
      createdAt: dailyLogs.createdAt,
      createdById: users.id,
      createdByName: users.fullName,
    })
    .from(dailyLogs)
    .leftJoin(jobs, eq(dailyLogs.jobId, jobs.id))
    .leftJoin(users, eq(dailyLogs.createdBy, users.id))
    .where(
      and(
        isNull(dailyLogs.deletedAt),
        jobIdFilter(dailyLogs.jobId),
        gte(dailyLogs.createdAt, since),
        dailyLogVisibilityFilter,
      ),
    )
    .orderBy(desc(dailyLogs.createdAt))
    .limit(15);

  // Top-line summary counts (mirrors /dashboard/stats).
  const summaryPromise = Promise.all([
    db
      .select({ total: count() })
      .from(jobs)
      .where(
        and(
          isNull(jobs.deletedAt),
          eq(jobs.status, "open"),
          accessibleJobIds ? inArray(jobs.id, accessibleJobIds) : undefined,
        ),
      ),
    db
      .select({ total: count() })
      .from(leads)
      .where(
        and(
          isNull(leads.deletedAt),
          eq(leads.status, "open"),
          accessibleLeadIds ? inArray(leads.id, accessibleLeadIds) : undefined,
        ),
      ),
    db
      .select({ total: count() })
      .from(scheduleItems)
      .where(
        and(
          isNull(scheduleItems.deletedAt),
          or(isNull(scheduleItems.isComplete), eq(scheduleItems.isComplete, false)),
          jobIdFilter(scheduleItems.jobId),
          scheduleVisibilityFilter,
        ),
      ),
  ]);

  const [
    weekItems,
    overdueRows,
    lastLogPerJob,
    openJobs,
    pendingCos,
    teamLogs,
    [activeJobsRow, openLeadsRow, openScheduleItemsRow],
  ] = await Promise.all([
    weekItemsPromise,
    overdueRowsPromise,
    lastLogPerJobPromise,
    openJobsPromise,
    pendingCosPromise,
    teamLogsPromise,
    summaryPromise,
  ]);

  const overdue = overdueRows.filter((row) =>
    isScheduleItemOverdue(
      {
        id: row.id,
        endDate: row.endDate,
        isComplete: row.isComplete,
        progress: row.progress,
      },
      today,
    ),
  );

  const lastLogMap = new Map<string, string | null>();
  for (const job of openJobs) lastLogMap.set(job.id, null);
  for (const row of lastLogPerJob) {
    if (row.jobId && lastLogMap.has(row.jobId)) {
      lastLogMap.set(row.jobId, row.lastLogDate);
    }
  }
  const missingLogJobIds = jobsMissingDailyLogs(
    openJobs.map((j) => j.id),
    lastLogMap,
    today,
    PM_AT_RISK_NO_LOG_WORKING_DAYS,
  );
  const missingLogJobs = openJobs
    .filter((j) => missingLogJobIds.includes(j.id))
    .slice(0, PM_AT_RISK_DRILLDOWN_LIMIT);

  const pendingCoCount = pendingCos.filter((co) =>
    isChangeOrderPending({ id: co.id, status: co.status }),
  ).length;

  return {
    role: "pm" as const,
    today,
    week: {
      start: weekStart,
      end: weekEnd,
      items: weekItems.map((row) => ({
        ...row,
        progress: row.progress ?? 0,
        isComplete: row.isComplete === true,
      })),
    },
    atRisk: {
      overdueScheduleItems: overdue.length,
      jobsMissingLogs: missingLogJobIds.length,
      pendingChangeOrders: pendingCoCount,
      samples: {
        overdue: overdue.map((row) => ({
          id: row.id,
          title: row.title,
          endDate: row.endDate,
          jobId: row.jobId,
          jobTitle: row.jobTitle,
        })),
        missingLogJobs,
        pendingChangeOrders: pendingCos.map((co) => ({
          id: co.id,
          number: co.number,
          amountCents: Number(co.amountCents ?? 0),
          jobId: co.jobId,
          jobTitle: co.jobTitle,
        })),
      },
    },
    teamLogs,
    summary: {
      activeJobs: Number(activeJobsRow[0]?.total ?? 0),
      openLeads: Number(openLeadsRow[0]?.total ?? 0),
      openScheduleItems: Number(openScheduleItemsRow[0]?.total ?? 0),
    },
  };
}

async function buildAdminHome(auth: NonNullable<Express.Request["auth"]>) {
  const today = todayIso();
  const monthStart = startOfMonthIso(today);

  // KPI counts.
  const kpiPromise = Promise.all([
    db
      .select({ total: count() })
      .from(jobs)
      .where(and(isNull(jobs.deletedAt), eq(jobs.status, "open"))),
    db
      .select({ total: count() })
      .from(leads)
      .where(and(isNull(leads.deletedAt), eq(leads.status, "open"))),
    db
      .select({ total: count() })
      .from(jobs)
      .where(
        and(
          isNull(jobs.deletedAt),
          gte(jobs.createdAt, new Date(`${monthStart}T00:00:00Z`)),
        ),
      ),
  ]);

  // AR outstanding across all trackers (admin sees everything).
  const lineItemRowsPromise = db
    .select({
      jobId: financialTrackers.jobId,
      clientId: jobs.clientId,
      scheduledValueCents: sovLineItems.scheduledValueCents,
      billedCents: sovLineItems.billedCents,
      isRemoved: sovLineItems.isRemoved,
    })
    .from(sovLineItems)
    .innerJoin(sovAreas, eq(sovLineItems.areaId, sovAreas.id))
    .innerJoin(financialTrackers, eq(sovAreas.trackerId, financialTrackers.id))
    .innerJoin(jobs, eq(financialTrackers.jobId, jobs.id))
    .where(isNull(jobs.deletedAt));

  const approvedCoRowsPromise = db
    .select({
      jobId: financialTrackers.jobId,
      clientId: jobs.clientId,
      amountCents: changeOrders.amountCents,
      status: changeOrders.status,
    })
    .from(changeOrders)
    .innerJoin(financialTrackers, eq(changeOrders.trackerId, financialTrackers.id))
    .innerJoin(jobs, eq(financialTrackers.jobId, jobs.id))
    .where(isNull(jobs.deletedAt));

  // Past-due invoices sample (tracker-level; we need totals + payments).
  const invoiceRowsPromise = db
    .select({
      id: trackerInvoices.id,
      invoiceNumber: trackerInvoices.invoiceNumber,
      invoiceDate: trackerInvoices.invoiceDate,
      totalCents: trackerInvoices.totalCents,
      jobId: financialTrackers.jobId,
      jobTitle: jobs.title,
      clientId: jobs.clientId,
      clientName: clients.companyName,
    })
    .from(trackerInvoices)
    .innerJoin(financialTrackers, eq(trackerInvoices.trackerId, financialTrackers.id))
    .innerJoin(jobs, eq(financialTrackers.jobId, jobs.id))
    .leftJoin(clients, eq(jobs.clientId, clients.id))
    .where(isNull(jobs.deletedAt))
    .orderBy(desc(trackerInvoices.invoiceDate))
    .limit(200);

  const paymentTotalsPromise = db
    .select({
      invoiceId: invoiceLinePayments.invoiceId,
      paidCents: sql<number>`coalesce(sum(${invoiceLinePayments.amountCents}), 0)`,
    })
    .from(invoiceLinePayments)
    .groupBy(invoiceLinePayments.invoiceId);

  // Jobs by status (the closest thing we have to a "stage" today).
  const jobsByStatusPromise = db
    .select({ status: jobs.status, total: count() })
    .from(jobs)
    .where(isNull(jobs.deletedAt))
    .groupBy(jobs.status);

  // Recent leads.
  const recentLeadsPromise = db
    .select({
      id: leads.id,
      title: leads.title,
      status: leads.status,
      city: leads.city,
      state: leads.state,
      confidence: leads.confidence,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(isNull(leads.deletedAt))
    .orderBy(desc(leads.createdAt))
    .limit(ADMIN_RECENT_LEADS_LIMIT);

  // This-month calendar items (range: start of this month → end of next month).
  const calendarStart = monthStart;
  const calendarEnd = isoDaysFromNow(60);
  const calendarItemsPromise = db
    .select({
      id: scheduleItems.id,
      title: scheduleItems.title,
      startDate: scheduleItems.startDate,
      endDate: scheduleItems.endDate,
      jobId: scheduleItems.jobId,
      jobTitle: jobs.title,
      displayColor: scheduleItems.displayColor,
    })
    .from(scheduleItems)
    .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
    .where(
      and(
        isNull(scheduleItems.deletedAt),
        isNull(jobs.deletedAt),
        lte(scheduleItems.startDate, calendarEnd),
        gte(scheduleItems.endDate, calendarStart),
      ),
    )
    .orderBy(scheduleItems.startDate)
    .limit(200);

  const [
    [activeJobsRow, openLeadsRow, newJobsThisMonthRow],
    lineItemRows,
    approvedCoRows,
    invoiceRows,
    paymentTotals,
    jobsByStatus,
    recentLeads,
    calendarItems,
  ] = await Promise.all([
    kpiPromise,
    lineItemRowsPromise,
    approvedCoRowsPromise,
    invoiceRowsPromise,
    paymentTotalsPromise,
    jobsByStatusPromise,
    recentLeadsPromise,
    calendarItemsPromise,
  ]);

  // Roll up open balance per client. Open balance = scheduled + approved COs
  // − billed, floored at 0 (mirrors the formula in financials.ts).
  const balanceByClient = new Map<string | null, { scheduled: number; billed: number; approvedCo: number }>();
  for (const row of lineItemRows) {
    if (row.isRemoved) continue;
    const key = row.clientId ?? null;
    const entry = balanceByClient.get(key) ?? { scheduled: 0, billed: 0, approvedCo: 0 };
    entry.scheduled += Number(row.scheduledValueCents ?? 0);
    entry.billed += Number(row.billedCents ?? 0);
    balanceByClient.set(key, entry);
  }
  for (const row of approvedCoRows) {
    if (row.status !== "approved") continue;
    const key = row.clientId ?? null;
    const entry = balanceByClient.get(key) ?? { scheduled: 0, billed: 0, approvedCo: 0 };
    entry.approvedCo += Number(row.amountCents ?? 0);
    balanceByClient.set(key, entry);
  }

  const arOutstandingCents = Array.from(balanceByClient.values()).reduce(
    (sum, e) => sum + Math.max(0, e.scheduled + e.approvedCo - e.billed),
    0,
  );

  // Resolve client names for the top N.
  const clientIds = Array.from(balanceByClient.keys()).filter(
    (id): id is string => typeof id === "string",
  );
  const clientNameRows = clientIds.length
    ? await db
        .select({ id: clients.id, name: clients.companyName })
        .from(clients)
        .where(inArray(clients.id, clientIds))
    : [];
  const clientNameById = new Map(clientNameRows.map((r) => [r.id, r.name]));

  const topClients = Array.from(balanceByClient.entries())
    .map(([clientId, e]) => ({
      clientId,
      clientName: clientId ? clientNameById.get(clientId) ?? "(Unknown client)" : "(No client)",
      openBalanceCents: Math.max(0, e.scheduled + e.approvedCo - e.billed),
    }))
    .filter((c) => c.openBalanceCents > 0)
    .sort((a, b) => b.openBalanceCents - a.openBalanceCents)
    .slice(0, ADMIN_TOP_CLIENTS_LIMIT);

  const paidByInvoice = new Map(
    paymentTotals.map((p) => [p.invoiceId, Number(p.paidCents ?? 0)]),
  );
  const pastDueInvoices = invoiceRows
    .map((inv) => {
      const paidCents = paidByInvoice.get(inv.id) ?? 0;
      return { ...inv, paidCents, totalCents: Number(inv.totalCents ?? 0) };
    })
    .filter((inv) =>
      isInvoicePastDue(
        {
          id: inv.id,
          invoiceDate: inv.invoiceDate,
          totalCents: inv.totalCents,
          paidCents: inv.paidCents,
        },
        today,
      ),
    )
    .slice(0, 10);

  // Sum "this month new contract value" from contractValueCents on jobs
  // created this month.
  const newContractRow = await db
    .select({
      total: sql<number>`coalesce(sum(${jobs.contractValueCents}), 0)`,
    })
    .from(jobs)
    .where(
      and(
        isNull(jobs.deletedAt),
        gte(jobs.createdAt, new Date(`${monthStart}T00:00:00Z`)),
      ),
    );

  return {
    role: "admin" as const,
    today,
    monthStart,
    kpis: {
      activeJobs: Number(activeJobsRow[0]?.total ?? 0),
      openLeads: Number(openLeadsRow[0]?.total ?? 0),
      newJobsThisMonth: Number(newJobsThisMonthRow[0]?.total ?? 0),
      newContractValueThisMonthCents: Number(newContractRow[0]?.total ?? 0),
      arOutstandingCents,
      pastDueInvoiceCount: pastDueInvoices.length,
    },
    topClients,
    pastDueInvoices,
    jobsByStage: jobsByStatus.map((row) => ({
      stage: row.status,
      total: Number(row.total ?? 0),
    })),
    recentLeads,
    calendar: {
      start: calendarStart,
      end: calendarEnd,
      items: calendarItems,
    },
  };
}

router.get(
  "/dashboard/home",
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    if (isAdmin(auth)) {
      res.json(await buildAdminHome(auth));
      return;
    }
    res.json(await buildCrewHome(auth));
  }),
);

export default router;
