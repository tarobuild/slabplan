import { and, count, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { dailyLogs, jobs, leads, scheduleItems } from "@workspace/db/schema";
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

export default router;
