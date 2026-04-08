import { and, count, desc, eq, gte, inArray, isNull, lte, lt, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  dailyLogs,
  jobs,
  leads,
  scheduleItems,
  users,
} from "@workspace/db/schema";
import { asyncHandler } from "../lib/http";

const router: IRouter = Router();

router.get(
  "/dashboard/stats",
  asyncHandler(async (req, res) => {
    const [activeJobsRow, openLeadsRow, openScheduleItemsRow, myDailyLogsRow] =
      await Promise.all([
        db
          .select({ total: count() })
          .from(jobs)
          .where(and(isNull(jobs.deletedAt), eq(jobs.status, "open")))
          .then((rows) => rows[0]),
        db
          .select({ total: count() })
          .from(leads)
          .where(
            and(
              isNull(leads.deletedAt),
              inArray(leads.status, ["open", "in_negotiation"]),
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
            ),
          )
          .then((rows) => rows[0]),
        db
          .select({ total: count() })
          .from(dailyLogs)
          .where(
            and(
              isNull(dailyLogs.deletedAt),
              eq(dailyLogs.createdBy, req.auth.userId),
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
    const today = new Date().toISOString().split("T")[0];
    const in14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

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
        .where(isNull(dailyLogs.deletedAt))
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
        .where(and(isNull(jobs.deletedAt), eq(jobs.status, "open")))
        .orderBy(desc(jobs.createdAt))
        .limit(5),
    ]);

    res.json({ upcomingItems, recentLogs, recentJobs });
  }),
);

router.get(
  "/dashboard/schedule",
  asyncHandler(async (req, res) => {
    const startParam = (req.query.start as string) ?? new Date().toISOString().split("T")[0];
    const endParam = (req.query.end as string) ?? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

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
          // items that overlap the requested range
          lte(scheduleItems.startDate, endParam),
          or(
            gte(scheduleItems.endDate, startParam),
            gte(scheduleItems.startDate, startParam),
          ),
        ),
      )
      .orderBy(scheduleItems.startDate)
      .limit(500);

    res.json({ items });
  }),
);

export default router;
