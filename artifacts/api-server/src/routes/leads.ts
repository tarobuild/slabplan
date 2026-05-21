import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  activityLog,
  clients,
  files,
  folders,
  jobAssignees,
  jobs,
  leadAttachments,
  leadContacts,
  leadSalespeople,
  leadSources,
  leadStatuses,
  leadTags,
  leads,
  users,
} from "@workspace/db/schema";
import {
  assertCanAccessClient,
  assertCanAccessLead,
  assertCanManageLead,
  listAccessibleLeadIds,
} from "../lib/authorization";
import { ensureSystemFolders, validateUploadForMediaType, writeActivity } from "../lib/file-manager";
import { getMcpContext } from "../middleware/mcp-context";
import { HttpError, asyncHandler } from "../lib/http";
import { emitRealtimeEvent } from "../lib/realtime";
import { buildContainsLikePattern } from "../lib/search";
import { decodeCursor, encodeCursor, isCursorModeRequested } from "../lib/cursor";
import { requireAdmin, requireManagerOrAbove } from "../middleware/require-auth";
import {
  getActiveOrganizationId,
  organizationScopeCondition,
} from "../lib/tenant-scope";
import {
  buildStoredFileName,
  buildUploadPath,
  deletePhysicalFile,
  probeStorageStatuses,
  writeUploadedBuffer,
  writeUploadedFromPath,
} from "../lib/storage";
import {
  cleanupTempUpload,
  persistWithStorageRollback,
  uploadArray,
} from "../lib/uploads";
import { createUploadPerUserRateLimit } from "../lib/rate-limit";

const uploadRateLimit = createUploadPerUserRateLimit();

const router: IRouter = Router();
router.use(requireManagerOrAbove);

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
    return normalized.length > 0 ? normalized : null;
  })
  .refine((value) => value === null || Number.isFinite(Number(value)), {
    message: "Revenue values must be valid numbers.",
  });

const optionalEmail = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
  })
  .refine((value) => value === null || value.includes("@"), {
    message: "A valid email address is required.",
  });

// Compute the midpoint between two decimal-string money values for
// pre-filling job.contractPrice on lead conversion. Returns the
// midpoint when both bounds are present, the populated bound when
// only one is set, or null when neither is set. Uses Number for the
// arithmetic; fine for the 0–10M range we deal with in practice.
function midpointMoney(
  min: string | null | undefined,
  max: string | null | undefined,
): string | null {
  const minN = min != null && min !== "" ? Number(min) : null;
  const maxN = max != null && max !== "" ? Number(max) : null;
  if (minN != null && maxN != null && Number.isFinite(minN) && Number.isFinite(maxN)) {
    return ((minN + maxN) / 2).toFixed(2);
  }
  if (minN != null && Number.isFinite(minN)) return minN.toFixed(2);
  if (maxN != null && Number.isFinite(maxN)) return maxN.toFixed(2);
  return null;
}

const leadListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  search: z.string().trim().optional(),
  status: z.enum(leadStatuses).optional(),
  // Comma-separated list of statuses to exclude. Used by the Stone Track
  // Leads list to default-hide converted (`won`) leads while still
  // allowing them to be revealed via the "Show converted" toggle. When
  // a `status` is also provided, that wins (no implicit exclusion).
  excludeStatuses: z
    .string()
    .trim()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const parts = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const valid = parts.filter((s): s is (typeof leadStatuses)[number] =>
        (leadStatuses as readonly string[]).includes(s),
      );
      return valid.length > 0 ? valid : undefined;
    }),
  // Exclude leads that have a live converted_to_job activity. The
  // Stone Track Leads list passes `excludeConverted=true` by default and
  // flips it off when the "Show converted" toggle is checked.
  excludeConverted: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
  // When true, the result is restricted to leads that have been converted
  // to a job. Used by the Stone Track Leads list when the user picks the
  // "Converted" entry in the status filter dropdown. Takes precedence over
  // `excludeConverted` if both are sent.
  onlyConverted: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const leadPayloadSchema = z.object({
  title: z.string().trim().min(1).max(255),
  streetAddress: optionalString,
  city: optionalString,
  state: optionalString.refine((value) => value === null || value.length <= 2, {
    message: "State must be a 2-character abbreviation.",
  }),
  zipCode: optionalString,
  confidence: z.coerce.number().int().min(0).max(100).optional().default(0),
  projectedSalesDate: optionalDate,
  estimatedRevenueMin: optionalMoney,
  estimatedRevenueMax: optionalMoney,
  status: z
    .enum(leadStatuses)
    .optional()
    .default("open"),
  projectType: optionalString,
  notes: optionalString,
  leadSource: optionalString,
  salespeople: z.array(z.string().uuid()).optional().default([]),
  tags: z.array(z.string().trim().min(1).max(100)).optional().default([]),
  sources: z.array(z.string().trim().min(1).max(100)).optional().default([]),
});

const contactCreateSchema = z
  .object({
    sourceContactId: z.string().uuid().optional(),
    firstName: optionalString,
    lastName: optionalString,
    displayName: optionalString,
    streetAddress: optionalString,
    city: optionalString,
    state: optionalString.refine((value) => value === null || value.length <= 2, {
      message: "State must be a 2-character abbreviation.",
    }),
    zipCode: optionalString,
    phone: optionalString,
    cellPhone: optionalString,
    email: optionalEmail,
    label: optionalString,
  })
  .superRefine((value, ctx) => {
    if (value.sourceContactId) {
      return;
    }

    if (!value.displayName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Display name is required.",
        path: ["displayName"],
      });
    }

    if (!value.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Email is required.",
        path: ["email"],
      });
    }
  });

const contactUpdateSchema = z.object({
  firstName: optionalString,
  lastName: optionalString,
  displayName: optionalString,
  streetAddress: optionalString,
  city: optionalString,
  state: optionalString.refine((value) => value === null || value.length <= 2, {
    message: "State must be a 2-character abbreviation.",
  }),
  zipCode: optionalString,
  phone: optionalString,
  cellPhone: optionalString,
  email: optionalEmail,
  label: optionalString,
});

const activityCreateSchema = z.object({
  title: z.string().trim().min(1).max(255),
  notes: optionalString,
});

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new HttpError(400, `Missing ${label}.`);
  }

  return normalized;
}

function normalizeUniqueStrings(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function toLeadValues(
  data: z.infer<typeof leadPayloadSchema>,
  createdBy: string,
  organizationId: string,
) {
  return {
    organizationId,
    title: data.title,
    streetAddress: data.streetAddress,
    city: data.city,
    state: data.state,
    zipCode: data.zipCode,
    confidence: data.confidence,
    projectedSalesDate: data.projectedSalesDate,
    estimatedRevenueMin: data.estimatedRevenueMin,
    estimatedRevenueMax: data.estimatedRevenueMax,
    status: data.status,
    projectType: data.projectType,
    notes: data.notes,
    leadSource: data.leadSource,
    createdBy,
  };
}

async function getLeadOrThrow(
  id: string,
  includeDeleted = false,
  auth?: NonNullable<Express.Request["auth"]>,
) {
  const conditions = [eq(leads.id, id)];
  const orgCondition = auth ? organizationScopeCondition(auth, leads.organizationId) : undefined;
  if (orgCondition) conditions.push(orgCondition);

  if (!includeDeleted) {
    conditions.push(isNull(leads.deletedAt));
  }

  const [lead] = await db
    .select()
    .from(leads)
    .where(and(...conditions))
    .limit(1);

  if (!lead) {
    throw new HttpError(404, "Lead not found.");
  }

  return lead;
}

async function getContactOrThrow(
  contactId: string,
  includeDeleted = false,
  auth?: NonNullable<Express.Request["auth"]>,
) {
  const conditions = [eq(leadContacts.id, contactId)];
  const orgCondition = auth ? organizationScopeCondition(auth, leadContacts.organizationId) : undefined;
  if (orgCondition) conditions.push(orgCondition);

  if (!includeDeleted) {
    conditions.push(isNull(leadContacts.deletedAt));
  }

  const [contact] = await db
    .select()
    .from(leadContacts)
    .where(and(...conditions))
    .limit(1);

  if (!contact) {
    throw new HttpError(404, "Contact not found.");
  }

  return contact;
}

async function ensureLeadAttachmentFolder(
  leadId: string,
  auth: NonNullable<Express.Request["auth"]>,
) {
  const lead = await getLeadOrThrow(leadId, false, auth);
  const title = `${lead.title} Attachments`;
  const organizationId = getActiveOrganizationId(auth);

  const [existing] = await db
    .select()
    .from(folders)
    .where(
      and(
        isNull(folders.jobId),
        eq(folders.scope, "lead"),
        eq(folders.leadId, leadId),
        eq(folders.title, title),
        eq(folders.mediaType, "document"),
        organizationScopeCondition(auth, folders.organizationId),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(folders)
    .values({
      organizationId,
      jobId: sql<string>`null`,
      scope: "lead",
      leadId,
      title,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
    })
    .returning();

  return created;
}

async function maybeDeletePhysicalFile(fileUrl: string | null | undefined, fileId: string) {
  if (!fileUrl) {
    return;
  }

  const [remainingFile] = await db
    .select({ total: count() })
    .from(files)
    .where(and(eq(files.fileUrl, fileUrl), sql`${files.id} <> ${fileId}`));

  if (!remainingFile || Number(remainingFile.total) === 0) {
    await deletePhysicalFile(fileUrl);
  }
}

async function assertClientBelongsToActiveOrganization(
  clientId: string,
  auth: NonNullable<Express.Request["auth"]>,
) {
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.id, clientId),
        organizationScopeCondition(auth, clients.organizationId),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);

  if (!client) {
    throw new HttpError(400, "Client is invalid for this organization.", undefined, "validation");
  }
}

async function syncLeadSalespeople(
  leadId: string,
  userIds: string[],
  organizationId: string,
) {
  await db.delete(leadSalespeople).where(eq(leadSalespeople.leadId, leadId));

  const uniqueUserIds = Array.from(new Set(userIds));

  if (uniqueUserIds.length > 0) {
    await db.insert(leadSalespeople).values(
      uniqueUserIds.map((userId) => ({
        organizationId,
        leadId,
        userId,
      })),
    );
  }
}

async function syncLeadTags(
  leadId: string,
  tags: string[],
  organizationId: string,
) {
  await db.delete(leadTags).where(eq(leadTags.leadId, leadId));

  const normalized = normalizeUniqueStrings(tags);

  if (normalized.length > 0) {
    await db.insert(leadTags).values(
      normalized.map((tagName) => ({
        organizationId,
        leadId,
        tagName,
      })),
    );
  }
}

async function syncLeadSources(
  leadId: string,
  leadSource: string | null,
  sources: string[],
  organizationId: string,
) {
  await db.delete(leadSources).where(eq(leadSources.leadId, leadId));

  const normalized = normalizeUniqueStrings([
    ...(leadSource ? [leadSource] : []),
    ...sources,
  ]);

  if (normalized.length > 0) {
    await db.insert(leadSources).values(
      normalized.map((sourceName) => ({
        organizationId,
        leadId,
        sourceName,
      })),
    );
  }
}

// Look up the job a lead was converted to (if any) via the activity log.
// Returns the most recent `converted_to_job` activity that still maps to a
// non-deleted job. Used to show the "View job" link on a converted lead and
// to enforce the 409 in the convert endpoint.
type ConvertedJobRef = {
  id: string;
  title: string;
  status: string;
  convertedAt: string | null;
};

async function lookupConvertedJobsByLeadIds(
  leadIds: string[],
  auth?: NonNullable<Express.Request["auth"]>,
): Promise<Map<string, ConvertedJobRef>> {
  const result = new Map<string, ConvertedJobRef>();
  if (leadIds.length === 0) return result;

  const rows = await db
    .select({
      leadId: activityLog.entityId,
      jobId: jobs.id,
      jobTitle: jobs.title,
      jobStatus: jobs.status,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .innerJoin(
      jobs,
      and(
        eq(jobs.id, sql`(${activityLog.metadata}->>'convertedJobId')::uuid`),
        auth ? organizationScopeCondition(auth, jobs.organizationId) : undefined,
        isNull(jobs.deletedAt),
      ),
    )
    .where(
      and(
        eq(activityLog.entityType, "lead"),
        eq(activityLog.action, "converted_to_job"),
        auth ? organizationScopeCondition(auth, activityLog.organizationId) : undefined,
        inArray(activityLog.entityId, leadIds),
      ),
    )
    .orderBy(desc(activityLog.createdAt));

  for (const row of rows) {
    if (!result.has(row.leadId)) {
      result.set(row.leadId, {
        id: row.jobId,
        title: row.jobTitle,
        status: row.jobStatus,
        convertedAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : row.createdAt
              ? new Date(row.createdAt as unknown as string).toISOString()
              : null,
      });
    }
  }
  return result;
}

// Set of leadIds that have already been converted to a (live) job. Used
// by the list endpoint to default-exclude converted leads regardless of
// their current `lead.status` (we reuse `won` for both manually-won and
// converted, so a status filter alone is too coarse).
async function listConvertedLeadIds(
  accessibleLeadIds: string[] | null,
  auth: NonNullable<Express.Request["auth"]>,
): Promise<Set<string>> {
  const result = new Set<string>();
  const conditions = [
    eq(activityLog.entityType, "lead"),
    eq(activityLog.action, "converted_to_job"),
  ];
  const activityOrgCondition = organizationScopeCondition(auth, activityLog.organizationId);
  if (activityOrgCondition) conditions.push(activityOrgCondition);
  if (accessibleLeadIds && accessibleLeadIds.length > 0) {
    conditions.push(inArray(activityLog.entityId, accessibleLeadIds));
  } else if (accessibleLeadIds && accessibleLeadIds.length === 0) {
    return result;
  }
  const rows = await db
    .selectDistinct({ leadId: activityLog.entityId })
    .from(activityLog)
    .innerJoin(
      jobs,
      and(
        eq(jobs.id, sql`(${activityLog.metadata}->>'convertedJobId')::uuid`),
        organizationScopeCondition(auth, jobs.organizationId),
        isNull(jobs.deletedAt),
      ),
    )
    .where(and(...conditions));
  for (const row of rows) {
    if (row.leadId) result.add(row.leadId);
  }
  return result;
}

async function hydrateLead(auth: NonNullable<Express.Request["auth"]>, leadId: string) {
  const accessibleLeadIds = await listAccessibleLeadIds(auth);
  const [lead] = await db
    .select({
      id: leads.id,
      title: leads.title,
      streetAddress: leads.streetAddress,
      city: leads.city,
      state: leads.state,
      zipCode: leads.zipCode,
      confidence: leads.confidence,
      projectedSalesDate: leads.projectedSalesDate,
      estimatedRevenueMin: leads.estimatedRevenueMin,
      estimatedRevenueMax: leads.estimatedRevenueMax,
      status: leads.status,
      projectType: leads.projectType,
      notes: leads.notes,
      leadSource: leads.leadSource,
      createdBy: leads.createdBy,
      createdByName: users.fullName,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .leftJoin(users, eq(leads.createdBy, users.id))
    .where(
      and(
        eq(leads.id, leadId),
        organizationScopeCondition(auth, leads.organizationId),
        isNull(leads.deletedAt),
      ),
    )
    .limit(1);

  if (!lead) {
    throw new HttpError(404, "Lead not found.");
  }

  const [contacts, salespeople, tags, sources, attachments, availableContacts] =
    await Promise.all([
      db
        .select({
          id: leadContacts.id,
          leadId: leadContacts.leadId,
          firstName: leadContacts.firstName,
          lastName: leadContacts.lastName,
          displayName: leadContacts.displayName,
          streetAddress: leadContacts.streetAddress,
          city: leadContacts.city,
          state: leadContacts.state,
          zipCode: leadContacts.zipCode,
          phone: leadContacts.phone,
          cellPhone: leadContacts.cellPhone,
          email: leadContacts.email,
          label: leadContacts.label,
          createdAt: leadContacts.createdAt,
          updatedAt: leadContacts.updatedAt,
        })
        .from(leadContacts)
        .where(
          and(
            eq(leadContacts.leadId, leadId),
            organizationScopeCondition(auth, leadContacts.organizationId),
            isNull(leadContacts.deletedAt),
          ),
        )
        .orderBy(asc(leadContacts.displayName)),
      db
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role,
          avatarUrl: users.avatarUrl,
        })
        .from(leadSalespeople)
        .innerJoin(users, eq(leadSalespeople.userId, users.id))
        .where(
          and(
            eq(leadSalespeople.leadId, leadId),
            organizationScopeCondition(auth, leadSalespeople.organizationId),
          ),
        )
        .orderBy(asc(users.fullName)),
      db
        .select({
          id: leadTags.id,
          tagName: leadTags.tagName,
        })
        .from(leadTags)
        .where(
          and(
            eq(leadTags.leadId, leadId),
            organizationScopeCondition(auth, leadTags.organizationId),
          ),
        )
        .orderBy(asc(leadTags.tagName)),
      db
        .select({
          id: leadSources.id,
          sourceName: leadSources.sourceName,
        })
        .from(leadSources)
        .where(
          and(
            eq(leadSources.leadId, leadId),
            organizationScopeCondition(auth, leadSources.organizationId),
          ),
        )
        .orderBy(asc(leadSources.sourceName)),
      db
        .select({
          id: leadAttachments.id,
          fileId: files.id,
          originalName: files.originalName,
          fileUrl: files.fileUrl,
          fileSize: files.fileSize,
          mimeType: files.mimeType,
          createdAt: files.createdAt,
          uploadedByName: users.fullName,
        })
        .from(leadAttachments)
        .innerJoin(files, eq(leadAttachments.fileId, files.id))
        .leftJoin(users, eq(files.uploadedBy, users.id))
        .where(
          and(
            eq(leadAttachments.leadId, leadId),
            organizationScopeCondition(auth, leadAttachments.organizationId),
            organizationScopeCondition(auth, files.organizationId),
          ),
        )
        .orderBy(desc(files.createdAt)),
      db
        .select({
          id: leadContacts.id,
          leadId: leadContacts.leadId,
          leadTitle: leads.title,
          displayName: leadContacts.displayName,
          email: leadContacts.email,
          phone: leadContacts.phone,
          cellPhone: leadContacts.cellPhone,
          label: leadContacts.label,
        })
        .from(leadContacts)
        .innerJoin(leads, eq(leadContacts.leadId, leads.id))
        .where(
          and(
            isNull(leadContacts.deletedAt),
            isNull(leads.deletedAt),
            organizationScopeCondition(auth, leadContacts.organizationId),
            organizationScopeCondition(auth, leads.organizationId),
            accessibleLeadIds ? inArray(leads.id, accessibleLeadIds) : undefined,
          ),
        )
        .orderBy(asc(leadContacts.displayName)),
    ]);

  const attachmentStatuses = await probeStorageStatuses(
    attachments.map((att) => att.fileUrl),
  );
  const annotatedAttachments = attachments.map((att) => ({
    ...att,
    storageStatus:
      att.fileUrl && attachmentStatuses.get(att.fileUrl) === "ok"
        ? ("ok" as const)
        : ("missing" as const),
  }));

  const convertedJobs = await lookupConvertedJobsByLeadIds([leadId], auth);

  return {
    lead: {
      ...lead,
      clientContact: contacts[0] ?? null,
      contacts,
      salespeople,
      tags: tags.map((tag) => tag.tagName),
      sources: sources.map((source) => source.sourceName),
      attachments: annotatedAttachments,
      availableContacts,
      convertedJob: convertedJobs.get(leadId) ?? null,
    },
  };
}

router.get(
  "/contacts",
  asyncHandler(async (req, res) => {
    const query =
      typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const accessibleLeadIds = await listAccessibleLeadIds(req.auth!);

    if (accessibleLeadIds && accessibleLeadIds.length === 0) {
      res.json({ contacts: [] });
      return;
    }

    const rows = await db
      .select({
        id: leadContacts.id,
        leadId: leadContacts.leadId,
        leadTitle: leads.title,
        displayName: leadContacts.displayName,
        email: leadContacts.email,
        phone: leadContacts.phone,
        cellPhone: leadContacts.cellPhone,
        label: leadContacts.label,
      })
      .from(leadContacts)
      .innerJoin(leads, eq(leadContacts.leadId, leads.id))
      .where(
        and(
          isNull(leadContacts.deletedAt),
          isNull(leads.deletedAt),
          organizationScopeCondition(req.auth!, leadContacts.organizationId),
          organizationScopeCondition(req.auth!, leads.organizationId),
          accessibleLeadIds ? inArray(leads.id, accessibleLeadIds) : undefined,
        ),
      )
      .orderBy(asc(leadContacts.displayName));

    const contacts = query
      ? rows.filter((contact) =>
          [contact.displayName, contact.email, contact.phone, contact.leadTitle]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query),
        )
      : rows;

    res.json({ contacts });
  }),
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = leadListQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid leads query.", query.error.flatten());
    }

    const accessibleLeadIds = await listAccessibleLeadIds(req.auth!);
    const { page, pageSize } = query.data;
    const isCursorMode = isCursorModeRequested(req.query as Record<string, unknown>);
    const cursorPayload = query.data.cursor ? decodeCursor(query.data.cursor) : null;
    const effectiveLimit = isCursorMode ? (query.data.limit ?? 25) : pageSize;

    if (accessibleLeadIds && accessibleLeadIds.length === 0) {
      if (isCursorMode) {
        res.json({
          leads: [],
          pagination: { limit: effectiveLimit, hasMore: false, nextCursor: null },
          summary: { estimatedRevenueMinTotal: "0", estimatedRevenueMaxTotal: "0" },
        });
        return;
      }
      res.json({
        leads: [],
        pagination: {
          page,
          pageSize,
          totalItems: 0,
          totalPages: 1,
        },
        summary: {
          estimatedRevenueMinTotal: "0",
          estimatedRevenueMaxTotal: "0",
        },
      });
      return;
    }

    const conditions = [isNull(leads.deletedAt)];
    const listOrgCondition = organizationScopeCondition(req.auth!, leads.organizationId);
    if (listOrgCondition) conditions.push(listOrgCondition);
    if (accessibleLeadIds) {
      conditions.push(inArray(leads.id, accessibleLeadIds));
    }

    if (query.data.status) {
      conditions.push(eq(leads.status, query.data.status));
    } else if (query.data.excludeStatuses && query.data.excludeStatuses.length > 0) {
      conditions.push(sql`${leads.status} not in (${sql.join(
        query.data.excludeStatuses.map((s) => sql`${s}`),
        sql`, `,
      )})`);
    }

    if (query.data.onlyConverted) {
      // "Converted" filter — restrict to leads that have a live
      // converted_to_job activity. If there are none, short-circuit to
      // an empty result so we don't need to round-trip the main query.
      const convertedIds = await listConvertedLeadIds(accessibleLeadIds, req.auth!);
      if (convertedIds.size === 0) {
        // Mirror the cursor/offset envelope used by the empty
        // `accessibleLeadIds` short-circuit above so the response shape
        // stays consistent across pagination modes.
        if (isCursorMode) {
          res.json({
            leads: [],
            pagination: { limit: effectiveLimit, hasMore: false, nextCursor: null },
            summary: { estimatedRevenueMinTotal: "0", estimatedRevenueMaxTotal: "0" },
          });
          return;
        }
        res.json({
          leads: [],
          pagination: {
            page,
            pageSize,
            totalItems: 0,
            totalPages: 1,
          },
          summary: {
            estimatedRevenueMinTotal: "0",
            estimatedRevenueMaxTotal: "0",
          },
        });
        return;
      }
      conditions.push(
        inArray(leads.id, Array.from(convertedIds)),
      );
    } else if (query.data.excludeConverted) {
      const convertedIds = await listConvertedLeadIds(accessibleLeadIds, req.auth!);
      if (convertedIds.size > 0) {
        conditions.push(
          sql`${leads.id} not in (${sql.join(
            Array.from(convertedIds).map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      }
    }

    if (query.data.search) {
      const search = buildContainsLikePattern(query.data.search);
      conditions.push(
        or(
          ilike(leads.title, search),
          ilike(leads.city, search),
          ilike(leads.state, search),
          ilike(leads.projectType, search),
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
        sql`(${leads.createdAt}, ${leads.id}) < (${cursorCreatedAt.toISOString()}::timestamptz, ${cursorPayload.id})`,
      );
    }

    const whereClause = and(...conditions);
    const fetchLimit = isCursorMode ? effectiveLimit + 1 : pageSize;
    const offset = isCursorMode ? 0 : (page - 1) * pageSize;

    const [totalRow, totalsRow] = isCursorMode
      ? [undefined, undefined]
      : await Promise.all([
          db
            .select({ total: count() })
            .from(leads)
            .where(whereClause)
            .then((rows) => rows[0]),
          db
            .select({
              estimatedRevenueMinTotal: sql<string>`coalesce(sum(${leads.estimatedRevenueMin}), 0)`,
              estimatedRevenueMaxTotal: sql<string>`coalesce(sum(${leads.estimatedRevenueMax}), 0)`,
            })
            .from(leads)
            .where(whereClause)
            .then((rows) => rows[0]),
        ]);

    const rows = await db
      .select({
        id: leads.id,
        title: leads.title,
        streetAddress: leads.streetAddress,
        city: leads.city,
        state: leads.state,
        zipCode: leads.zipCode,
        confidence: leads.confidence,
        projectedSalesDate: leads.projectedSalesDate,
        estimatedRevenueMin: leads.estimatedRevenueMin,
        estimatedRevenueMax: leads.estimatedRevenueMax,
        status: leads.status,
        projectType: leads.projectType,
        leadSource: leads.leadSource,
        createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
        createdByName: users.fullName,
      })
      .from(leads)
      .leftJoin(users, eq(leads.createdBy, users.id))
      .where(whereClause)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(fetchLimit)
      .offset(offset);

    const leadIds = rows.map((lead) => lead.id);
    const contactRows =
      leadIds.length > 0
        ? await db
            .select({
              id: leadContacts.id,
              leadId: leadContacts.leadId,
              displayName: leadContacts.displayName,
              email: leadContacts.email,
              phone: leadContacts.phone,
              label: leadContacts.label,
            })
            .from(leadContacts)
            .where(
              and(
                inArray(leadContacts.leadId, leadIds),
                organizationScopeCondition(req.auth!, leadContacts.organizationId),
                isNull(leadContacts.deletedAt),
              ),
            )
            .orderBy(asc(leadContacts.createdAt))
        : [];

    const primaryContactByLeadId = new Map<
      string,
      (typeof contactRows)[number]
    >();

    for (const contact of contactRows) {
      if (!contact.leadId || primaryContactByLeadId.has(contact.leadId)) {
        continue;
      }

      primaryContactByLeadId.set(contact.leadId, contact);
    }

    const convertedJobByLeadId = await lookupConvertedJobsByLeadIds(leadIds, req.auth!);

    if (isCursorMode) {
      const hasMore = rows.length > effectiveLimit;
      const trimmed = hasMore ? rows.slice(0, effectiveLimit) : rows;
      const last = trimmed[trimmed.length - 1];
      const nextCursor = hasMore && last
        ? encodeCursor({ v: 1, k: [last.createdAt.toISOString()], id: last.id })
        : null;
      res.json({
        leads: trimmed.map((lead) => ({
          ...lead,
          clientContact: primaryContactByLeadId.get(lead.id) ?? null,
          convertedJob: convertedJobByLeadId.get(lead.id) ?? null,
        })),
        pagination: { limit: effectiveLimit, hasMore, nextCursor },
        summary: { estimatedRevenueMinTotal: "0", estimatedRevenueMaxTotal: "0" },
      });
      return;
    }

    const totalItems = Number(totalRow?.total ?? 0);

    res.json({
      leads: rows.map((lead) => ({
        ...lead,
        clientContact: primaryContactByLeadId.get(lead.id) ?? null,
        convertedJob: convertedJobByLeadId.get(lead.id) ?? null,
      })),
      pagination: {
        page: query.data.page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      },
      summary: {
        estimatedRevenueMinTotal: totalsRow?.estimatedRevenueMinTotal ?? "0",
        estimatedRevenueMaxTotal: totalsRow?.estimatedRevenueMaxTotal ?? "0",
      },
    });
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = leadPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid lead payload.", body.error.flatten());
    }

    const organizationId = getActiveOrganizationId(req.auth!);
    const [lead] = await db
      .insert(leads)
      .values(toLeadValues(body.data, req.auth!.userId, organizationId))
      .returning();

    await Promise.all([
      syncLeadSalespeople(lead.id, body.data.salespeople, organizationId),
      syncLeadTags(lead.id, body.data.tags, organizationId),
      syncLeadSources(lead.id, body.data.leadSource, body.data.sources, organizationId),
    ]);

    await writeActivity({
      entityType: "lead",
      entityId: lead.id,
      action: "created",
      userId: req.auth!.userId,
      jobId: null,
      leadId: lead.id,
      description: `Created lead ${lead.title}`,
      organizationId,
    });

    res.status(201).json(await hydrateLead(req.auth!, lead.id));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const leadId = getParam(req.params.id, "lead id");
    await assertCanAccessLead(req.auth!, leadId);
    res.json(await hydrateLead(req.auth!, leadId));
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = leadPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid lead payload.", body.error.flatten());
    }

    const leadId = getParam(req.params.id, "lead id");
    await assertCanManageLead(req.auth!, leadId);
    const existing = await getLeadOrThrow(leadId, false, req.auth!);
    const organizationId = getActiveOrganizationId(req.auth!);

    await db
      .update(leads)
      .set({
        ...toLeadValues(body.data, existing.createdBy ?? req.auth!.userId, organizationId),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leads.id, leadId),
          organizationScopeCondition(req.auth!, leads.organizationId),
        ),
      );

    await Promise.all([
      syncLeadSalespeople(leadId, body.data.salespeople, organizationId),
      syncLeadTags(leadId, body.data.tags, organizationId),
      syncLeadSources(leadId, body.data.leadSource, body.data.sources, organizationId),
    ]);

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "updated",
      userId: req.auth!.userId,
      jobId: null,
      leadId,
      description: `Updated lead ${body.data.title}`,
      organizationId,
    });

    if (existing.status !== body.data.status) {
      emitRealtimeEvent("lead:status-changed", {
        id: leadId,
        title: body.data.title,
        previousStatus: existing.status,
        status: body.data.status,
      }, leadId);
    }

    res.json(await hydrateLead(req.auth!, leadId));
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const leadId = getParam(req.params.id, "lead id");
    await assertCanManageLead(req.auth!, leadId);
    const lead = await getLeadOrThrow(leadId, false, req.auth!);
    const organizationId = getActiveOrganizationId(req.auth!);
    const deletedAt = new Date();

    await db
      .update(leads)
      .set({
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(
        and(
          eq(leads.id, leadId),
          organizationScopeCondition(req.auth!, leads.organizationId),
        ),
      );

    await db
      .update(leadContacts)
      .set({
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(
        and(
          eq(leadContacts.leadId, leadId),
          organizationScopeCondition(req.auth!, leadContacts.organizationId),
        ),
      );

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "deleted",
      userId: req.auth!.userId,
      jobId: null,
      leadId,
      description: `Deleted lead ${lead.title}`,
      organizationId,
    });

    res.json({ success: true });
  }),
);

router.post(
  "/:id/contacts",
  asyncHandler(async (req, res) => {
    const body = contactCreateSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid contact payload.", body.error.flatten());
    }

    const leadId = getParam(req.params.id, "lead id");
    await assertCanManageLead(req.auth!, leadId);
    await getLeadOrThrow(leadId, false, req.auth!);
    const organizationId = getActiveOrganizationId(req.auth!);

    let values;

    if (body.data.sourceContactId) {
      const source = await getContactOrThrow(body.data.sourceContactId, false, req.auth!);
      await assertCanAccessLead(req.auth!, source.leadId);
      values = {
        organizationId,
        leadId,
        firstName: source.firstName,
        lastName: source.lastName,
        displayName: source.displayName,
        streetAddress: source.streetAddress,
        city: source.city,
        state: source.state,
        zipCode: source.zipCode,
        phone: source.phone,
        cellPhone: source.cellPhone,
        email: source.email,
        label: source.label,
      };
    } else {
      values = {
        organizationId,
        leadId,
        firstName: body.data.firstName,
        lastName: body.data.lastName,
        displayName: body.data.displayName!,
        streetAddress: body.data.streetAddress,
        city: body.data.city,
        state: body.data.state,
        zipCode: body.data.zipCode,
        phone: body.data.phone,
        cellPhone: body.data.cellPhone,
        email: body.data.email!,
        label: body.data.label,
      };
    }

    const [contact] = await db.insert(leadContacts).values(values).returning();

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "contact_added",
      userId: req.auth!.userId,
      jobId: null,
      leadId,
      description: `Added contact ${contact.displayName}`,
      organizationId,
      extra: {
        contactId: contact.id,
      },
    });

    res.status(201).json({ contact });
  }),
);

router.put(
  "/:id/contacts/:contactId",
  asyncHandler(async (req, res) => {
    const body = contactUpdateSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid contact payload.", body.error.flatten());
    }

    const leadId = getParam(req.params.id, "lead id");
    const contactId = getParam(req.params.contactId, "contact id");
    await assertCanManageLead(req.auth!, leadId);
    await getLeadOrThrow(leadId, false, req.auth!);
    const organizationId = getActiveOrganizationId(req.auth!);

    const existing = await getContactOrThrow(contactId, false, req.auth!);

    if (existing.leadId !== leadId) {
      throw new HttpError(400, "Contact does not belong to this lead.");
    }

    const [contact] = await db
      .update(leadContacts)
      .set({
        firstName: body.data.firstName ?? existing.firstName,
        lastName: body.data.lastName ?? existing.lastName,
        displayName: body.data.displayName ?? existing.displayName,
        streetAddress: body.data.streetAddress ?? existing.streetAddress,
        city: body.data.city ?? existing.city,
        state: body.data.state ?? existing.state,
        zipCode: body.data.zipCode ?? existing.zipCode,
        phone: body.data.phone ?? existing.phone,
        cellPhone: body.data.cellPhone ?? existing.cellPhone,
        email: body.data.email ?? existing.email,
        label: body.data.label ?? existing.label,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leadContacts.id, contactId),
          organizationScopeCondition(req.auth!, leadContacts.organizationId),
        ),
      )
      .returning();

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "contact_updated",
      userId: req.auth!.userId,
      jobId: null,
      leadId,
      description: `Updated contact ${contact.displayName}`,
      organizationId,
      extra: {
        contactId: contact.id,
      },
    });

    res.json({ contact });
  }),
);

router.delete(
  "/:id/contacts/:contactId",
  asyncHandler(async (req, res) => {
    const leadId = getParam(req.params.id, "lead id");
    const contactId = getParam(req.params.contactId, "contact id");
    await assertCanManageLead(req.auth!, leadId);
    await getLeadOrThrow(leadId, false, req.auth!);
    const organizationId = getActiveOrganizationId(req.auth!);

    const contact = await getContactOrThrow(contactId, false, req.auth!);

    if (contact.leadId !== leadId) {
      throw new HttpError(400, "Contact does not belong to this lead.");
    }

    await db
      .update(leadContacts)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leadContacts.id, contactId),
          organizationScopeCondition(req.auth!, leadContacts.organizationId),
        ),
      );

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "contact_deleted",
      userId: req.auth!.userId,
      jobId: null,
      leadId,
      description: `Deleted contact ${contact.displayName}`,
      organizationId,
      extra: {
        contactId,
      },
    });

    res.json({ success: true });
  }),
);

router.post(
  "/:id/attachments",
  uploadRateLimit,
  uploadArray("files", 20),
  asyncHandler(async (req, res) => {
    const leadId = getParam(req.params.id, "lead id");
    await assertCanManageLead(req.auth!, leadId);
    await getLeadOrThrow(leadId, false, req.auth!);
    const organizationId = getActiveOrganizationId(req.auth!);

    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    if (uploadedFiles.length === 0) {
      throw new HttpError(400, "At least one attachment is required.");
    }

    const folder = await ensureLeadAttachmentFolder(leadId, req.auth!);
    const attachments = [];

    for (const uploadedFile of uploadedFiles) {
      validateUploadForMediaType("document", uploadedFile);

      const storedName = buildStoredFileName(uploadedFile.originalname);
      const { fileUrl } = buildUploadPath({
        jobId: `lead-${leadId}`,
        mediaType: "document",
        storedFileName: storedName,
      });

      try {
        if (uploadedFile.path) {
          await writeUploadedFromPath(fileUrl, uploadedFile.path, {
            contentType: uploadedFile.mimetype,
          });
        } else {
          await writeUploadedBuffer(fileUrl, uploadedFile.buffer, {
            contentType: uploadedFile.mimetype,
          });
        }
      } finally {
        await cleanupTempUpload(uploadedFile);
      }

      // Wrap the DB inserts and the activity log write in a single
      // upload-rollback boundary. The persist step uses a transaction so
      // a half-written pair (file row without attachment) cannot
      // escape. If the activity log write fails after the transaction
      // commits, the rollback callback removes the committed rows and
      // the helper deletes the freshly uploaded object so storage and
      // database stay in sync.
      const { file, attachment } = await persistWithStorageRollback({
        fileUrl,
        context: "lead-attachment-upload:rollback",
        persist: async () =>
          await db.transaction(async (tx) => {
            const [createdFile] = await tx
              .insert(files)
              .values({
                organizationId,
                folderId: folder.id,
                filename: storedName,
                originalName: uploadedFile.originalname,
                fileUrl,
                fileSize: uploadedFile.size,
                mimeType: uploadedFile.mimetype,
                uploadedBy: req.auth!.userId,
              })
              .returning();

            const [createdAttachment] = await tx
              .insert(leadAttachments)
              .values({
                organizationId,
                leadId,
                fileId: createdFile.id,
              })
              .returning();

            return { file: createdFile, attachment: createdAttachment };
          }),
        postCommit: async ({ file: createdFile, attachment: createdAttachment }) => {
          await writeActivity({
            entityType: "lead",
            entityId: leadId,
            action: "attachment_uploaded",
            userId: req.auth!.userId,
            jobId: null,
            leadId,
            description: `Uploaded attachment ${createdFile.originalName}`,
            organizationId,
            extra: {
              fileId: createdFile.id,
              attachmentId: createdAttachment.id,
            },
          });
        },
        rollback: async ({ file: createdFile, attachment: createdAttachment }) => {
          await db
            .delete(leadAttachments)
            .where(eq(leadAttachments.id, createdAttachment.id));
          await db.delete(files).where(eq(files.id, createdFile.id));
        },
      });

      attachments.push({
        id: attachment.id,
        fileId: file.id,
        originalName: file.originalName,
        fileUrl: file.fileUrl,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        createdAt: file.createdAt,
        storageStatus: "ok" as const,
      });
    }

    res.status(201).json({ attachments });
  }),
);

router.delete(
  "/:id/attachments/:attachmentId",
  asyncHandler(async (req, res) => {
    const leadId = getParam(req.params.id, "lead id");
    const attachmentId = getParam(req.params.attachmentId, "attachment id");
    await assertCanManageLead(req.auth!, leadId);
    await getLeadOrThrow(leadId, false, req.auth!);
    const organizationId = getActiveOrganizationId(req.auth!);

    const [attachment] = await db
      .select({
        id: leadAttachments.id,
        fileId: files.id,
        originalName: files.originalName,
        fileUrl: files.fileUrl,
      })
      .from(leadAttachments)
      .innerJoin(files, eq(leadAttachments.fileId, files.id))
      .where(
        and(
          eq(leadAttachments.id, attachmentId),
          eq(leadAttachments.leadId, leadId),
          organizationScopeCondition(req.auth!, leadAttachments.organizationId),
          organizationScopeCondition(req.auth!, files.organizationId),
        ),
      )
      .limit(1);

    if (!attachment) {
      throw new HttpError(404, "Attachment not found.");
    }

    await db
      .delete(leadAttachments)
      .where(
        and(
          eq(leadAttachments.id, attachmentId),
          organizationScopeCondition(req.auth!, leadAttachments.organizationId),
        ),
      );
    await db
      .delete(files)
      .where(
        and(
          eq(files.id, attachment.fileId),
          organizationScopeCondition(req.auth!, files.organizationId),
        ),
      );
    await maybeDeletePhysicalFile(attachment.fileUrl, attachment.fileId);

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "attachment_deleted",
      userId: req.auth!.userId,
      jobId: null,
      leadId,
      description: `Deleted attachment ${attachment.originalName}`,
      organizationId,
      extra: {
        fileId: attachment.fileId,
        attachmentId,
      },
    });

    res.json({ success: true });
  }),
);

// New-client payload mirrors the inline shape used by `POST /clients`
// so the 2-step convert flow can create a client and a job in one
// admin action.
const convertNewClientSchema = z.object({
  companyName: z.string().trim().min(1).max(255),
  phone: optionalString,
  email: optionalString,
  streetAddress: optionalString,
  city: optionalString,
  state: optionalString.refine((v) => v === null || v.length <= 2, {
    message: "State must be a 2-character abbreviation.",
  }),
  zipCode: optionalString,
  notes: optionalString,
});

const JOB_TYPE_VALUES = [
  "kitchen_countertops",
  "bathrooms",
  "flooring",
  "backsplash",
  "full_house_project",
  "custom",
] as const;

const convertJobOverridesSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  streetAddress: optionalString.optional(),
  city: optionalString.optional(),
  state: optionalString
    .refine((v) => v === null || v.length <= 2, {
      message: "State must be a 2-character abbreviation.",
    })
    .optional(),
  zipCode: optionalString.optional(),
  contractPrice: optionalMoney.optional(),
  projectedStart: optionalDate.optional(),
  projectedCompletion: optionalDate.optional(),
  jobType: z.enum(JOB_TYPE_VALUES).nullable().optional(),
  projectManagerId: z.string().uuid().nullable().optional(),
  assigneeIds: z.array(z.string().uuid()).optional(),
});

const convertToJobSchema = z
  .object({
    clientId: z.string().uuid().optional(),
    newClient: convertNewClientSchema.optional(),
    job: convertJobOverridesSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.clientId && value.newClient) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either clientId or newClient, not both.",
        path: ["clientId"],
      });
    }
  });

router.post(
  "/:id/convert-to-job",
  // Job creation is admin-only (post-#277 owner directive). The leads
  // router allows managers to manage scoped leads, but converting a lead
  // creates a job, so the stricter gate applies here too.
  requireAdmin,
  asyncHandler(async (req, res) => {
    const leadId = getParam(req.params.id, "lead id");
    await assertCanManageLead(req.auth!, leadId);
    const lead = await getLeadOrThrow(leadId, false, req.auth!);
    const organizationId = getActiveOrganizationId(req.auth!);

    // Body is optional for backwards compatibility (the original endpoint
    // accepted an empty `{}` body and still does — see audit-fixes test).
    const rawBody = req.body && typeof req.body === "object" ? req.body : {};
    const parsed = convertToJobSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new HttpError(
        400,
        "Invalid convert-to-job payload.",
        parsed.error.flatten(),
      );
    }
    const body = parsed.data;

    // Pre-flight duplicate check (cheap fast-path before opening a tx).
    // The authoritative race-safe check is repeated INSIDE the tx below
    // while the lead row is locked, so two concurrent calls cannot both
    // pass.
    {
      const existing = await lookupConvertedJobsByLeadIds([leadId], req.auth!);
      const alreadyConverted = existing.get(leadId);
      if (alreadyConverted) {
        throw new HttpError(
          409,
          "This lead has already been converted to a job.",
          { convertedJob: alreadyConverted },
        );
      }
    }

    // If the caller passed an existing clientId, validate it is
    // accessible (admins always pass; the helper still runs the
    // lookup for defense-in-depth).
    if (body.clientId) {
      await assertCanAccessClient(req.auth!, body.clientId);
      await assertClientBelongsToActiveOrganization(body.clientId, req.auth!);
    }

    const overrides = body.job ?? {};
    const assigneeIds = Array.from(new Set(overrides.assigneeIds ?? []));
    const mcpCtx = getMcpContext();

    const { job } = await db.transaction(async (tx) => {
      // 0. Lock the lead row for the duration of the tx so two
      // concurrent convert calls serialize. The second one will then
      // observe the converted_to_job activity inserted by the first
      // and 409-out below.
      await tx.execute(
        sql`SELECT id FROM leads WHERE id = ${leadId} FOR UPDATE`,
      );

      // 0b. Race-safe duplicate check: re-read the activity log under
      // the row lock. If another request raced ahead, abort with 409
      // and the rollback throws away any work this branch did.
      const dupRows = await tx
        .select({
          jobId: jobs.id,
          jobTitle: jobs.title,
          jobStatus: jobs.status,
          createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .innerJoin(
          jobs,
          and(
            eq(jobs.id, sql`(${activityLog.metadata}->>'convertedJobId')::uuid`),
            organizationScopeCondition(req.auth!, jobs.organizationId),
            isNull(jobs.deletedAt),
          ),
        )
        .where(
          and(
            eq(activityLog.entityType, "lead"),
            eq(activityLog.action, "converted_to_job"),
            eq(activityLog.entityId, leadId),
            organizationScopeCondition(req.auth!, activityLog.organizationId),
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .limit(1);
      if (dupRows.length > 0) {
        const r = dupRows[0];
        throw new HttpError(
          409,
          "This lead has already been converted to a job.",
          {
            convertedJob: {
              id: r.jobId,
              title: r.jobTitle,
              status: r.jobStatus,
              convertedAt:
                r.createdAt instanceof Date
                  ? r.createdAt.toISOString()
                  : r.createdAt
                    ? new Date(r.createdAt as unknown as string).toISOString()
                    : null,
            },
          },
        );
      }

      // 1. Resolve client: either use the passed-in id or create a new one.
      let clientId: string | null = body.clientId ?? null;
      if (!clientId && body.newClient) {
        const [createdClient] = await tx
          .insert(clients)
          .values({
            organizationId,
            companyName: body.newClient.companyName,
            phone: body.newClient.phone,
            email: body.newClient.email,
            streetAddress: body.newClient.streetAddress,
            city: body.newClient.city,
            state: body.newClient.state,
            zipCode: body.newClient.zipCode,
            notes: body.newClient.notes,
            createdBy: req.auth!.userId,
          })
          .returning();
        clientId = createdClient.id;
      }

      // 2. Insert the job, applying overrides on top of the lead's
      // pre-fill values.
      const jobValues = {
        organizationId,
        title: overrides.title ?? lead.title,
        status: "open" as const,
        streetAddress: overrides.streetAddress ?? lead.streetAddress,
        city: overrides.city ?? lead.city,
        state: overrides.state ?? lead.state,
        zipCode: overrides.zipCode ?? lead.zipCode,
        contractPrice:
          overrides.contractPrice ??
          midpointMoney(lead.estimatedRevenueMin, lead.estimatedRevenueMax),
        jobType:
          overrides.jobType !== undefined
            ? overrides.jobType
            : (JOB_TYPE_VALUES as readonly string[]).includes(
                  lead.projectType ?? "",
                )
              ? (lead.projectType as (typeof JOB_TYPE_VALUES)[number])
              : null,
        projectedStart: overrides.projectedStart ?? lead.projectedSalesDate,
        projectedCompletion: overrides.projectedCompletion ?? null,
        projectManagerId:
          overrides.projectManagerId !== undefined
            ? overrides.projectManagerId
            : null,
        clientId,
        workDays: ["mon", "tue", "wed", "thu", "fri"],
        createdBy: req.auth!.userId,
      };
      const [createdJob] = await tx.insert(jobs).values(jobValues).returning();

      // 3. Insert assignees (unique constraint protects against dupes).
      if (assigneeIds.length > 0) {
        await tx
          .insert(jobAssignees)
          .values(assigneeIds.map((userId) => ({ organizationId, jobId: createdJob.id, userId })))
          .onConflictDoNothing();
      }

      // 4. Mark the source lead as converted (uses the existing
      // `won` status — see replit.md for why we don't introduce a new
      // enum value).
      await tx
        .update(leads)
        .set({
          status: "won",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(leads.id, leadId),
            organizationScopeCondition(req.auth!, leads.organizationId),
          ),
        );

      // 5. Insert the converted_to_job activity INSIDE the tx so the
      // marker that drives dedupe / list filtering / link-back lives or
      // dies with the rest of the conversion. This intentionally does
      // not call writeActivity() because that helper uses the global
      // db handle (not the tx) and would commit independently.
      const mcpTag = mcpCtx
        ? {
            actor: `agent_via_mcp(${mcpCtx.userId}, ${mcpCtx.patId}, ${mcpCtx.toolName})` as const,
            actorKind: "agent_via_mcp" as const,
            toolName: mcpCtx.toolName,
            patId: mcpCtx.patId,
          }
        : undefined;
      const description = `Converted lead ${lead.title} to job ${createdJob.title}`;
      const [activityRow] = await tx
        .insert(activityLog)
        .values({
          organizationId,
          entityType: "lead",
          entityId: leadId,
          action: "converted_to_job",
          userId: req.auth!.userId,
          metadata: {
            description,
            jobId: createdJob.id,
            jobTitle: createdJob.title,
            leadId,
            mediaType: null,
            folderId: null,
            fileId: null,
            convertedJobId: createdJob.id,
            ...(mcpTag ?? {}),
          },
        })
        .returning({
          id: activityLog.id,
          entityType: activityLog.entityType,
          entityId: activityLog.entityId,
          action: activityLog.action,
          metadata: activityLog.metadata,
          createdAt: activityLog.createdAt,
        });

      return { job: createdJob, activity: activityRow };
    });

    // Best-effort post-commit side effects. Failures here MUST NOT
    // unwind the conversion — the lead is already marked as converted
    // and the user holds a job id. We log + continue.
    try {
      await ensureSystemFolders(job.id, { includeJobTemplates: true });
    } catch (err) {
      req.log.error(
        { err, jobId: job.id },
        "convert-to-job: ensureSystemFolders failed",
      );
    }

    if (lead.status !== "won") {
      emitRealtimeEvent(
        "lead:status-changed",
        {
          id: leadId,
          title: lead.title,
          previousStatus: lead.status,
          status: "won",
        },
        leadId,
      );
    }

    res.status(201).json({
      job: {
        id: job.id,
        title: job.title,
        status: job.status,
      },
    });
  }),
);

router.post(
  "/:id/activities",
  asyncHandler(async (req, res) => {
    const body = activityCreateSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid activity payload.", body.error.flatten());
    }

    const leadId = getParam(req.params.id, "lead id");
    await assertCanManageLead(req.auth!, leadId);
    await getLeadOrThrow(leadId, false, req.auth!);
    const organizationId = getActiveOrganizationId(req.auth!);

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "activity_logged",
      userId: req.auth!.userId,
      jobId: null,
      leadId,
      description: body.data.notes
        ? `${body.data.title}: ${body.data.notes}`
        : body.data.title,
      organizationId,
    });

    res.status(201).json({ success: true });
  }),
);

export default router;
