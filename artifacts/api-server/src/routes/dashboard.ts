import { and, count, desc, eq, gte, inArray, isNull, lte, lt, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  dailyLogs,
  jobs,
  leads,
  scheduleItems,
  users,
} from "@workspace/db/schema";
import { listAccessibleJobIds, listAccessibleLeadIds } from "../lib/authorization";
import { buildDailyLogVisibilityFilter } from "../lib/daily-log-visibility";
import { HttpError, asyncHandler } from "../lib/http";
import { buildScheduleListVisibilityFilter } from "../lib/schedule-visibility";

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

    if (accessibleJobIds && accessibleJobIds.length === 0) {
      res.json({ items: [] });
      return;
    }

    const scheduleVisibilityFilter = buildScheduleListVisibilityFilter(req.auth!);

    const items = await db
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
          accessibleJobIds ? inArray(scheduleItems.jobId, accessibleJobIds) : undefined,
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

    res.json({ items });
  }),
);

export default router;
