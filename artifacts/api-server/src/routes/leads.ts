import { asc, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { leads } from "@workspace/db/schema";
import { asyncHandler } from "../lib/http";

const router: IRouter = Router();

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({
        id: leads.id,
        title: leads.title,
        city: leads.city,
        state: leads.state,
        confidence: leads.confidence,
        status: leads.status,
        projectType: leads.projectType,
        estimatedRevenueMin: leads.estimatedRevenueMin,
        estimatedRevenueMax: leads.estimatedRevenueMax,
        projectedSalesDate: leads.projectedSalesDate,
        createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .where(isNull(leads.deletedAt))
      .orderBy(asc(leads.title));

    res.json({ leads: rows });
  }),
);

export default router;
