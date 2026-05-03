import { and, asc, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { clients, files, folders, jobAssignees, jobs, type NewJob, users } from "@workspace/db/schema";
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
import { decodeCursor, encodeCursor, isCursorModeRequested } from "../lib/cursor";
import { sql } from "drizzle-orm";

const router: IRouter = Router();
type DbExecutor = Pick<typeof db, "insert" | "delete">;

const jobQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  search: z.string().trim().optional(),
  status: z.enum(["open", "closed", "archived"]).optional(),
  clientId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const optionalCents = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(n)) return Number.NaN; // invalid sentinel; refine catches it
    return Math.trunc(n);
  })
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER), {
    message: "Money fields must be a non-negative integer number of cents.",
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

const jobPayloadBaseSchema = z.object({
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
  contractValueCents: optionalCents.optional().default(null),
  amountPaidCents: optionalCents.optional().default(null),
});

function checkPaidNotOverContract(
  data: { contractValueCents?: number | null; amountPaidCents?: number | null },
  ctx: z.RefinementCtx,
) {
  const paid = data.amountPaidCents;
  const contract = data.contractValueCents;
  if (
    paid !== null &&
    paid !== undefined &&
    contract !== null &&
    contract !== undefined &&
    paid > contract
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amountPaidCents"],
      message: "Amount paid cannot exceed contract value.",
    });
  }
}

const jobPayloadSchema = jobPayloadBaseSchema.superRefine(checkPaidNotOverContract);

const createJobPayloadSchema = jobPayloadBaseSchema
  .extend({
    assigneeIds: z.array(z.string().uuid()).optional().default([]),
  })
  .superRefine(checkPaidNotOverContract)
  .superRefine((data, ctx) => {
    // POST /jobs requires a real clientId. The DB column stays nullable
    // only so the "Unknown client" placeholder can absorb legacy and
    // orphaned rows; new jobs must always be attached to a chosen client.
    if (!data.clientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientId"],
        message: "clientId is required when creating a job.",
      });
    }
  });

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new HttpError(400, `Missing ${label}.`);
  }

  return normalized;
}

function toJobInsert(data: z.infer<typeof jobPayloadBaseSchema>, createdBy: string): NewJob {
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
    contractValueCents: data.contractValueCents ?? null,
    amountPaidCents: data.amountPaidCents ?? null,
    createdBy,
  };
}

async function listJobAssignees(jobId: string) {
  return db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      avatarUrl: users.avatarUrl,
    })
    .from(jobAssignees)
    .innerJoin(users, eq(jobAssignees.userId, users.id))
    .where(
      and(
        eq(jobAssignees.jobId, jobId),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(users.fullName));
}

async function ensureAssignableUserIds(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds));

  if (uniqueUserIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      id: users.id,
    })
    .from(users)
    .where(
      and(
        inArray(users.id, uniqueUserIds),
        inArray(users.role, ["project_manager", "crew_member"]),
        isNull(users.deletedAt),
      ),
    );

  if (rows.length !== uniqueUserIds.length) {
    throw new HttpError(400, "One or more assignees are invalid.");
  }

  return uniqueUserIds;
}

async function insertJobAssignees(
  jobId: string,
  userIds: string[],
  executor: DbExecutor = db,
) {
  const uniqueUserIds = Array.from(new Set(userIds));

  if (uniqueUserIds.length === 0) {
    return;
  }

  await executor
    .insert(jobAssignees)
    .values(
      uniqueUserIds.map((userId) => ({
        jobId,
        userId,
      })),
    )
    .onConflictDoNothing();
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
      contractValueCents: jobs.contractValueCents,
      amountPaidCents: jobs.amountPaidCents,
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

  if (!job) {
    return null;
  }

  const assignees = await listJobAssignees(id);

  return {
    ...job,
    assignees,
  };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = jobQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid jobs query.", query.error.flatten());
    }

    const accessibleJobIds = await listAccessibleJobIds(req.auth!);
    const { page, pageSize } = query.data;
    const isCursorMode = isCursorModeRequested(req.query as Record<string, unknown>);
    const cursorPayload = query.data.cursor ? decodeCursor(query.data.cursor) : null;
    const effectiveLimit = isCursorMode ? (query.data.limit ?? 25) : pageSize;

    if (accessibleJobIds && accessibleJobIds.length === 0) {
      if (isCursorMode) {
        res.json({
          jobs: [],
          pagination: { limit: effectiveLimit, hasMore: false, nextCursor: null },
        });
        return;
      }
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

    if (query.data.clientId) {
      conditions.push(eq(jobs.clientId, query.data.clientId));
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

    if (cursorPayload) {
      const cursorCreatedAtRaw = String(cursorPayload.k[0] ?? "");
      const cursorCreatedAt = new Date(cursorCreatedAtRaw);
      if (Number.isNaN(cursorCreatedAt.getTime())) {
        throw new HttpError(400, "Invalid cursor.", undefined, "validation");
      }
      conditions.push(
        sql`(${jobs.createdAt}, ${jobs.id}) < (${cursorCreatedAt.toISOString()}::timestamptz, ${cursorPayload.id})`,
      );
    }

    const whereClause = and(...conditions);
    const fetchLimit = isCursorMode ? effectiveLimit + 1 : pageSize;
    const offset = isCursorMode ? 0 : (page - 1) * pageSize;

    const totalPromise = isCursorMode
      ? Promise.resolve([{ total: 0 }])
      : db.select({ total: count() }).from(jobs).where(whereClause);

    const [totalRow] = await totalPromise;

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
        contractValueCents: jobs.contractValueCents,
        amountPaidCents: jobs.amountPaidCents,
        projectManagerId: jobs.projectManagerId,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .leftJoin(clients, eq(jobs.clientId, clients.id))
      .where(whereClause)
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(fetchLimit)
      .offset(offset);

    if (isCursorMode) {
      const hasMore = rows.length > effectiveLimit;
      const trimmed = hasMore ? rows.slice(0, effectiveLimit) : rows;
      const last = trimmed[trimmed.length - 1];
      const nextCursor = hasMore && last
        ? encodeCursor({ v: 1, k: [last.createdAt.toISOString()], id: last.id })
        : null;
      res.json({
        jobs: trimmed,
        pagination: { limit: effectiveLimit, hasMore, nextCursor },
      });
      return;
    }

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
    const body = createJobPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid job payload.", body.error.flatten());
    }

    const payload =
      req.auth!.role === "project_manager"
        ? {
            ...body.data,
            projectManagerId: req.auth!.userId,
          }
        : body.data;
    const assigneeIds =
      req.auth!.role === "admin"
        ? await ensureAssignableUserIds(payload.assigneeIds)
        : [];

    if (req.auth!.role !== "admin" && payload.assigneeIds.length > 0) {
      throw new HttpError(403, "Only admins can assign workers when creating a job.");
    }

    const job = await db.transaction(async (tx) => {
      const [createdJob] = await tx
        .insert(jobs)
        .values(toJobInsert(payload, req.auth!.userId))
        .returning();

      await insertJobAssignees(createdJob.id, assigneeIds, tx);

      return createdJob;
    });

    await ensureSystemFolders(job.id, { includeJobTemplates: true });
    await writeActivity({
      entityType: "job",
      entityId: job.id,
      action: "created",
      userId: req.auth!.userId,
      jobId: job.id,
      description: `Created job ${job.title}`,
    });

    const hydrated = await findJobById(job.id);

    res.status(201).json({ job: hydrated });
  }),
);

const assigneePayloadSchema = z.object({
  userId: z.string().uuid(),
});

router.get(
  "/:id/assignees",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.id, "job id");
    await assertCanAccessJob(req.auth!, jobId);
    const job = await findJobById(jobId);

    if (!job) {
      throw new HttpError(404, "Job not found.");
    }

    res.json({
      assignees: job.assignees,
    });
  }),
);

router.post(
  "/:id/assignees",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = assigneePayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid assignee payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.id, "job id");
    const job = await findJobById(jobId);

    if (!job) {
      throw new HttpError(404, "Job not found.");
    }

    const [userId] = await ensureAssignableUserIds([body.data.userId]);
    await insertJobAssignees(jobId, [userId]);

    res.status(201).json({
      assignees: await listJobAssignees(jobId),
    });
  }),
);

router.delete(
  "/:id/assignees/:userId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.id, "job id");
    const userId = getParam(req.params.userId, "user id");
    const job = await findJobById(jobId);

    if (!job) {
      throw new HttpError(404, "Job not found.");
    }

    await db
      .delete(jobAssignees)
      .where(
        and(
          eq(jobAssignees.jobId, jobId),
          eq(jobAssignees.userId, userId),
        ),
      );

    res.json({
      assignees: await listJobAssignees(jobId),
    });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.id, "job id");
    await assertCanAccessJob(req.auth!, jobId);
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
    await assertCanManageJob(req.auth!, jobId);
    const existing = await findJobById(jobId);

    if (!existing) {
      throw new HttpError(404, "Job not found.");
    }

    const payload =
      req.auth!.role === "project_manager"
        ? {
            ...body.data,
            projectManagerId: req.auth!.userId,
          }
        : body.data;

    const [updated] = await db
      .update(jobs)
      .set({
        ...toJobInsert(payload, existing.createdById ?? req.auth!.userId),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
      .returning();

    await ensureSystemFolders(updated.id);
    await writeActivity({
      entityType: "job",
      entityId: updated.id,
      action: "updated",
      userId: req.auth!.userId,
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
    await assertCanAccessJob(req.auth!, jobId);
    const existing = await findJobById(jobId);

    if (!existing) {
      throw new HttpError(404, "Job not found.");
    }

    const deletedAt = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(jobs)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(eq(jobs.id, jobId));

      const relatedFolders = await tx
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.jobId, jobId));

      if (relatedFolders.length === 0) {
        return;
      }

      const folderIds = relatedFolders.map((folder) => folder.id);
      await tx
        .update(folders)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(inArray(folders.id, folderIds));
      await tx
        .update(files)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(inArray(files.folderId, folderIds));
    });

    await writeActivity({
      entityType: "job",
      entityId: jobId,
      action: "deleted",
      userId: req.auth!.userId,
      jobId,
      description: `Archived job ${existing.title}`,
    });

    res.json({ success: true });
  }),
);

export default router;
