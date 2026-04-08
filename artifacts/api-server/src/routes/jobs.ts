import { and, asc, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { clients, files, folders, jobs, type NewJob, users } from "@workspace/db/schema";
import {
  assertCanAccessJob,
  assertCanManageJob,
  listAccessibleJobIds,
} from "../lib/authorization";
import { ensureSystemFolders, writeActivity } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";
import { emitRealtimeEvent } from "../lib/realtime";
import { buildContainsLikePattern } from "../lib/search";
import { requireAdmin, requireManagerOrAbove } from "../middleware/require-auth";

const router: IRouter = Router();

const jobQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  search: z.string().trim().optional(),
  status: z.enum(["open", "closed", "archived"]).optional(),
});

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const optionalDate = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  })
  .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "Dates must be in YYYY-MM-DD format.",
  });

const optionalMoney = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const normalized = typeof value === "number" ? value.toString() : value.trim();
    return normalized.length === 0 ? null : normalized;
  })
  .refine((value) => value === null || Number.isFinite(Number(value)), {
    message: "Contract price must be a valid number.",
  });

const jobPayloadSchema = z.object({
  title: z.string().trim().min(1).max(255),
  status: z.enum(["open", "closed", "archived"]).optional().default("open"),
  streetAddress: optionalString,
  city: optionalString,
  state: optionalString.refine((value) => value === null || value.length <= 2, {
    message: "State must be a 2-character abbreviation.",
  }),
  zipCode: optionalString,
  contractPrice: optionalMoney,
  jobType: optionalString,
  workDays: z
    .array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]))
    .nullable()
    .optional()
    .default(null),
  projectedStart: optionalDate,
  projectedCompletion: optionalDate,
  actualStart: optionalDate,
  actualCompletion: optionalDate,
  contractType: z.enum(["fixed_price", "open_book"]).nullable().optional().default(null),
  internalNotes: optionalString,
  subVendorNotes: optionalString,
  squareFeet: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined || v === "") return null;
      const s = typeof v === "number" ? v.toString() : v.trim();
      return s.length === 0 ? null : s;
    })
    .refine((v) => v === null || Number.isFinite(Number(v)), {
      message: "Square feet must be a valid number.",
    }),
  permitNumber: optionalString,
  projectManagerId: z.string().uuid().nullable().optional().default(null),
  clientId: z.string().uuid().nullable().optional().default(null),
});

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new HttpError(400, `Missing ${label}.`);
  }

  return normalized;
}

function toJobInsert(data: z.infer<typeof jobPayloadSchema>, createdBy: string): NewJob {
  return {
    title: data.title,
    status: data.status,
    streetAddress: data.streetAddress,
    city: data.city,
    state: data.state,
    zipCode: data.zipCode,
    contractPrice: data.contractPrice,
    jobType: data.jobType,
    workDays: data.workDays,
    projectedStart: data.projectedStart,
    projectedCompletion: data.projectedCompletion,
    actualStart: data.actualStart,
    actualCompletion: data.actualCompletion,
    contractType: data.contractType ?? null,
    internalNotes: data.internalNotes ?? null,
    subVendorNotes: data.subVendorNotes ?? null,
    squareFeet: data.squareFeet ?? null,
    permitNumber: data.permitNumber ?? null,
    projectManagerId: data.projectManagerId ?? null,
    clientId: data.clientId ?? null,
    createdBy,
  };
}

async function findJobById(id: string) {
  const projectManagers = alias(users, "pm");
  const [job] = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      status: jobs.status,
      city: jobs.city,
      state: jobs.state,
      streetAddress: jobs.streetAddress,
      zipCode: jobs.zipCode,
      jobType: jobs.jobType,
      contractPrice: jobs.contractPrice,
      projectedStart: jobs.projectedStart,
      projectedCompletion: jobs.projectedCompletion,
      actualStart: jobs.actualStart,
      actualCompletion: jobs.actualCompletion,
      workDays: jobs.workDays,
      contractType: jobs.contractType,
      internalNotes: jobs.internalNotes,
      subVendorNotes: jobs.subVendorNotes,
      squareFeet: jobs.squareFeet,
      permitNumber: jobs.permitNumber,
      projectManagerId: jobs.projectManagerId,
      projectManagerName: projectManagers.fullName,
      clientId: jobs.clientId,
      clientName: clients.companyName,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
      createdById: users.id,
      createdByName: users.fullName,
    })
    .from(jobs)
    .leftJoin(users, eq(jobs.createdBy, users.id))
    .leftJoin(projectManagers, eq(jobs.projectManagerId, projectManagers.id))
    .leftJoin(clients, eq(jobs.clientId, clients.id))
    .where(and(eq(jobs.id, id), isNull(jobs.deletedAt)))
    .limit(1);

  return job ?? null;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = jobQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid jobs query.", query.error.flatten());
    }

    const accessibleJobIds = await listAccessibleJobIds(req.auth);
    const { page, pageSize } = query.data;

    if (accessibleJobIds && accessibleJobIds.length === 0) {
      res.json({
        jobs: [],
        pagination: {
          page,
          pageSize,
          totalItems: 0,
          totalPages: 1,
        },
      });
      return;
    }

    const conditions = [isNull(jobs.deletedAt)];
    if (accessibleJobIds) {
      conditions.push(inArray(jobs.id, accessibleJobIds));
    }

    if (query.data.status) {
      conditions.push(eq(jobs.status, query.data.status));
    }

    if (query.data.search) {
      const search = buildContainsLikePattern(query.data.search);
      conditions.push(
        or(
          ilike(jobs.title, search),
          ilike(jobs.city, search),
          ilike(jobs.state, search),
          ilike(jobs.jobType, search),
        )!,
      );
    }

    const whereClause = and(...conditions);
    const offset = (page - 1) * pageSize;

    const [totalRow] = await db
      .select({
        total: count(),
      })
      .from(jobs)
      .where(whereClause);

    const rows = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        status: jobs.status,
        city: jobs.city,
        state: jobs.state,
        streetAddress: jobs.streetAddress,
        zipCode: jobs.zipCode,
        jobType: jobs.jobType,
        contractPrice: jobs.contractPrice,
        contractType: jobs.contractType,
        projectedStart: jobs.projectedStart,
        projectedCompletion: jobs.projectedCompletion,
        actualStart: jobs.actualStart,
        actualCompletion: jobs.actualCompletion,
        workDays: jobs.workDays,
        squareFeet: jobs.squareFeet,
        permitNumber: jobs.permitNumber,
        clientId: jobs.clientId,
        clientName: clients.companyName,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .leftJoin(clients, eq(jobs.clientId, clients.id))
      .where(whereClause)
      .orderBy(desc(jobs.createdAt), asc(jobs.title))
      .limit(pageSize)
      .offset(offset);

    const totalItems = Number(totalRow?.total ?? 0);

    res.json({
      jobs: rows,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      },
    });
  }),
);

router.post(
  "/",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const body = jobPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid job payload.", body.error.flatten());
    }

    const payload =
      req.auth.role === "project_manager"
        ? {
            ...body.data,
            projectManagerId: req.auth.userId,
          }
        : body.data;

    const [job] = await db
      .insert(jobs)
      .values(toJobInsert(payload, req.auth.userId))
      .returning();

    await ensureSystemFolders(job.id);
    await writeActivity({
      entityType: "job",
      entityId: job.id,
      action: "created",
      userId: req.auth.userId,
      jobId: job.id,
      description: `Created job ${job.title}`,
    });

    const hydrated = await findJobById(job.id);

    res.status(201).json({ job: hydrated });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.id, "job id");
    await assertCanAccessJob(req.auth, jobId);
    const job = await findJobById(jobId);

    if (!job) {
      throw new HttpError(404, "Job not found.");
    }

    res.json({ job });
  }),
);

router.put(
  "/:id",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const body = jobPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid job payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.id, "job id");
    await assertCanManageJob(req.auth, jobId);
    const existing = await findJobById(jobId);

    if (!existing) {
      throw new HttpError(404, "Job not found.");
    }

    const payload =
      req.auth.role === "project_manager"
        ? {
            ...body.data,
            projectManagerId: req.auth.userId,
          }
        : body.data;

    const [updated] = await db
      .update(jobs)
      .set({
        ...toJobInsert(payload, existing.createdById ?? req.auth.userId),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
      .returning();

    await ensureSystemFolders(updated.id);
    await writeActivity({
      entityType: "job",
      entityId: updated.id,
      action: "updated",
      userId: req.auth.userId,
      jobId: updated.id,
      description: `Updated job ${updated.title}`,
    });

    if (existing.status !== updated.status) {
      emitRealtimeEvent("job:status-changed", {
        id: updated.id,
        title: updated.title,
        previousStatus: existing.status,
        status: updated.status,
      }, updated.id);
    }

    const hydrated = await findJobById(updated.id);

    res.json({ job: hydrated });
  }),
);

router.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.id, "job id");
    await assertCanAccessJob(req.auth, jobId);
    const existing = await findJobById(jobId);

    if (!existing) {
      throw new HttpError(404, "Job not found.");
    }

    const deletedAt = new Date();

    await db
      .update(jobs)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(jobs.id, jobId));

    const relatedFolders = await db
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.jobId, jobId));

    if (relatedFolders.length > 0) {
      const folderIds = relatedFolders.map((folder) => folder.id);
      await db
        .update(folders)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(inArray(folders.id, folderIds));
      await db
        .update(files)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(inArray(files.folderId, folderIds));
    }

    await writeActivity({
      entityType: "job",
      entityId: jobId,
      action: "deleted",
      userId: req.auth.userId,
      jobId,
      description: `Archived job ${existing.title}`,
    });

    res.json({ success: true });
  }),
);

export default router;
