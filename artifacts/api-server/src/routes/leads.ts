import multer from "multer";
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
  files,
  folders,
  jobs,
  leadAttachments,
  leadContacts,
  leadSalespeople,
  leadSources,
  leadTags,
  leads,
  users,
} from "@workspace/db/schema";
import {
  assertCanAccessLead,
  assertCanManageLead,
  listAccessibleLeadIds,
} from "../lib/authorization";
import { ensureSystemFolders, validateUploadForMediaType, writeActivity } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";
import { emitRealtimeEvent } from "../lib/realtime";
import { requireManagerOrAbove } from "../middleware/require-auth";
import {
  buildStoredFileName,
  buildUploadPath,
  deletePhysicalFile,
  writeUploadedBuffer,
} from "../lib/storage";

const router: IRouter = Router();
router.use(requireManagerOrAbove);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 200,
    files: 20,
  },
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

const leadListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  search: z.string().trim().optional(),
  status: z.enum(["open", "in_negotiation", "won", "lost", "archived"]).optional(),
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
    .enum(["open", "in_negotiation", "won", "lost", "archived"])
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

function toLeadValues(data: z.infer<typeof leadPayloadSchema>, createdBy: string) {
  return {
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

async function getLeadOrThrow(id: string, includeDeleted = false) {
  const conditions = [eq(leads.id, id)];

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

async function getContactOrThrow(contactId: string, includeDeleted = false) {
  const conditions = [eq(leadContacts.id, contactId)];

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

async function ensureLeadAttachmentFolder(leadId: string) {
  const title = `Lead ${leadId} Attachments`;

  const [existing] = await db
    .select()
    .from(folders)
    .where(
      and(
        isNull(folders.jobId),
        eq(folders.title, title),
        eq(folders.mediaType, "document"),
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
      jobId: null,
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

async function syncLeadSalespeople(leadId: string, userIds: string[]) {
  await db.delete(leadSalespeople).where(eq(leadSalespeople.leadId, leadId));

  const uniqueUserIds = Array.from(new Set(userIds));

  if (uniqueUserIds.length > 0) {
    await db.insert(leadSalespeople).values(
      uniqueUserIds.map((userId) => ({
        leadId,
        userId,
      })),
    );
  }
}

async function syncLeadTags(leadId: string, tags: string[]) {
  await db.delete(leadTags).where(eq(leadTags.leadId, leadId));

  const normalized = normalizeUniqueStrings(tags);

  if (normalized.length > 0) {
    await db.insert(leadTags).values(
      normalized.map((tagName) => ({
        leadId,
        tagName,
      })),
    );
  }
}

async function syncLeadSources(leadId: string, leadSource: string | null, sources: string[]) {
  await db.delete(leadSources).where(eq(leadSources.leadId, leadId));

  const normalized = normalizeUniqueStrings([
    ...(leadSource ? [leadSource] : []),
    ...sources,
  ]);

  if (normalized.length > 0) {
    await db.insert(leadSources).values(
      normalized.map((sourceName) => ({
        leadId,
        sourceName,
      })),
    );
  }
}

async function hydrateLead(leadId: string) {
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
    .where(and(eq(leads.id, leadId), isNull(leads.deletedAt)))
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
        .where(and(eq(leadContacts.leadId, leadId), isNull(leadContacts.deletedAt)))
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
        .where(eq(leadSalespeople.leadId, leadId))
        .orderBy(asc(users.fullName)),
      db
        .select({
          id: leadTags.id,
          tagName: leadTags.tagName,
        })
        .from(leadTags)
        .where(eq(leadTags.leadId, leadId))
        .orderBy(asc(leadTags.tagName)),
      db
        .select({
          id: leadSources.id,
          sourceName: leadSources.sourceName,
        })
        .from(leadSources)
        .where(eq(leadSources.leadId, leadId))
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
        .where(eq(leadAttachments.leadId, leadId))
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
        .where(and(isNull(leadContacts.deletedAt), isNull(leads.deletedAt)))
        .orderBy(asc(leadContacts.displayName)),
    ]);

  return {
    lead: {
      ...lead,
      clientContact: contacts[0] ?? null,
      contacts,
      salespeople,
      tags: tags.map((tag) => tag.tagName),
      sources: sources.map((source) => source.sourceName),
      attachments,
      availableContacts,
    },
  };
}

router.get(
  "/contacts",
  asyncHandler(async (req, res) => {
    const query =
      typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const accessibleLeadIds = await listAccessibleLeadIds(req.auth);

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

    const accessibleLeadIds = await listAccessibleLeadIds(req.auth);
    const { page, pageSize } = query.data;

    if (accessibleLeadIds && accessibleLeadIds.length === 0) {
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
    if (accessibleLeadIds) {
      conditions.push(inArray(leads.id, accessibleLeadIds));
    }

    if (query.data.status) {
      conditions.push(eq(leads.status, query.data.status));
    }

    if (query.data.search) {
      const search = `%${query.data.search}%`;
      conditions.push(
        or(
          ilike(leads.title, search),
          ilike(leads.city, search),
          ilike(leads.state, search),
          ilike(leads.projectType, search),
        )!,
      );
    }

    const whereClause = and(...conditions);
    const offset = (page - 1) * pageSize;

    const [totalRow, totalsRow] = await Promise.all([
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
      .orderBy(desc(leads.createdAt), asc(leads.title))
      .limit(pageSize)
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
            .where(and(inArray(leadContacts.leadId, leadIds), isNull(leadContacts.deletedAt)))
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

    const totalItems = Number(totalRow?.total ?? 0);

    res.json({
      leads: rows.map((lead) => ({
        ...lead,
        clientContact: primaryContactByLeadId.get(lead.id) ?? null,
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

    const [lead] = await db
      .insert(leads)
      .values(toLeadValues(body.data, req.auth.userId))
      .returning();

    await Promise.all([
      syncLeadSalespeople(lead.id, body.data.salespeople),
      syncLeadTags(lead.id, body.data.tags),
      syncLeadSources(lead.id, body.data.leadSource, body.data.sources),
    ]);

    await writeActivity({
      entityType: "lead",
      entityId: lead.id,
      action: "created",
      userId: req.auth.userId,
      jobId: lead.id,
      description: `Created lead ${lead.title}`,
      extra: {
        leadId: lead.id,
      },
    });

    res.status(201).json(await hydrateLead(lead.id));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const leadId = getParam(req.params.id, "lead id");
    await assertCanAccessLead(req.auth, leadId);
    res.json(await hydrateLead(leadId));
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
    await assertCanManageLead(req.auth, leadId);
    const existing = await getLeadOrThrow(leadId);

    await db
      .update(leads)
      .set({
        ...toLeadValues(body.data, existing.createdBy ?? req.auth.userId),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    await Promise.all([
      syncLeadSalespeople(leadId, body.data.salespeople),
      syncLeadTags(leadId, body.data.tags),
      syncLeadSources(leadId, body.data.leadSource, body.data.sources),
    ]);

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "updated",
      userId: req.auth.userId,
      jobId: leadId,
      description: `Updated lead ${body.data.title}`,
      extra: {
        leadId,
      },
    });

    if (existing.status !== body.data.status) {
      emitRealtimeEvent("lead:status-changed", {
        id: leadId,
        title: body.data.title,
        previousStatus: existing.status,
        status: body.data.status,
      }, leadId);
    }

    res.json(await hydrateLead(leadId));
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const leadId = getParam(req.params.id, "lead id");
    await assertCanManageLead(req.auth, leadId);
    const lead = await getLeadOrThrow(leadId);
    const deletedAt = new Date();

    await db
      .update(leads)
      .set({
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(eq(leads.id, leadId));

    await db
      .update(leadContacts)
      .set({
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(eq(leadContacts.leadId, leadId));

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "deleted",
      userId: req.auth.userId,
      jobId: leadId,
      description: `Deleted lead ${lead.title}`,
      extra: {
        leadId,
      },
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
    await assertCanManageLead(req.auth, leadId);
    await getLeadOrThrow(leadId);

    let values;

    if (body.data.sourceContactId) {
      const source = await getContactOrThrow(body.data.sourceContactId);
      values = {
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
      userId: req.auth.userId,
      jobId: leadId,
      description: `Added contact ${contact.displayName}`,
      extra: {
        leadId,
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
    await assertCanManageLead(req.auth, leadId);
    await getLeadOrThrow(leadId);

    const existing = await getContactOrThrow(contactId);

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
      .where(eq(leadContacts.id, contactId))
      .returning();

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "contact_updated",
      userId: req.auth.userId,
      jobId: leadId,
      description: `Updated contact ${contact.displayName}`,
      extra: {
        leadId,
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
    await assertCanManageLead(req.auth, leadId);
    await getLeadOrThrow(leadId);

    const contact = await getContactOrThrow(contactId);

    if (contact.leadId !== leadId) {
      throw new HttpError(400, "Contact does not belong to this lead.");
    }

    await db
      .update(leadContacts)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leadContacts.id, contactId));

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "contact_deleted",
      userId: req.auth.userId,
      jobId: leadId,
      description: `Deleted contact ${contact.displayName}`,
      extra: {
        leadId,
        contactId,
      },
    });

    res.json({ success: true });
  }),
);

router.post(
  "/:id/attachments",
  upload.array("files", 20),
  asyncHandler(async (req, res) => {
    const leadId = getParam(req.params.id, "lead id");
    await assertCanManageLead(req.auth, leadId);
    await getLeadOrThrow(leadId);

    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    if (uploadedFiles.length === 0) {
      throw new HttpError(400, "At least one attachment is required.");
    }

    const folder = await ensureLeadAttachmentFolder(leadId);
    const attachments = [];

    for (const uploadedFile of uploadedFiles) {
      validateUploadForMediaType("document", uploadedFile);

      const storedName = buildStoredFileName(uploadedFile.originalname);
      const { fileUrl } = buildUploadPath({
        jobId: `lead-${leadId}`,
        mediaType: "document",
        storedFileName: storedName,
      });

      await writeUploadedBuffer(fileUrl, uploadedFile.buffer);

      const [file] = await db
        .insert(files)
        .values({
          folderId: folder.id,
          filename: storedName,
          originalName: uploadedFile.originalname,
          fileUrl,
          fileSize: uploadedFile.size,
          mimeType: uploadedFile.mimetype,
          uploadedBy: req.auth.userId,
        })
        .returning();

      const [attachment] = await db
        .insert(leadAttachments)
        .values({
          leadId,
          fileId: file.id,
        })
        .returning();

      attachments.push({
        id: attachment.id,
        fileId: file.id,
        originalName: file.originalName,
        fileUrl: file.fileUrl,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        createdAt: file.createdAt,
      });

      await writeActivity({
        entityType: "lead",
        entityId: leadId,
        action: "attachment_uploaded",
        userId: req.auth.userId,
        jobId: leadId,
        description: `Uploaded attachment ${file.originalName}`,
        extra: {
          leadId,
          fileId: file.id,
          attachmentId: attachment.id,
        },
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
    await assertCanManageLead(req.auth, leadId);
    await getLeadOrThrow(leadId);

    const [attachment] = await db
      .select({
        id: leadAttachments.id,
        fileId: files.id,
        originalName: files.originalName,
        fileUrl: files.fileUrl,
      })
      .from(leadAttachments)
      .innerJoin(files, eq(leadAttachments.fileId, files.id))
      .where(and(eq(leadAttachments.id, attachmentId), eq(leadAttachments.leadId, leadId)))
      .limit(1);

    if (!attachment) {
      throw new HttpError(404, "Attachment not found.");
    }

    await db.delete(leadAttachments).where(eq(leadAttachments.id, attachmentId));
    await db.delete(files).where(eq(files.id, attachment.fileId));
    await maybeDeletePhysicalFile(attachment.fileUrl, attachment.fileId);

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "attachment_deleted",
      userId: req.auth.userId,
      jobId: leadId,
      description: `Deleted attachment ${attachment.originalName}`,
      extra: {
        leadId,
        fileId: attachment.fileId,
        attachmentId,
      },
    });

    res.json({ success: true });
  }),
);

router.post(
  "/:id/convert-to-job",
  asyncHandler(async (req, res) => {
    const leadId = getParam(req.params.id, "lead id");
    await assertCanManageLead(req.auth, leadId);
    const lead = await getLeadOrThrow(leadId);

    const [job] = await db
      .insert(jobs)
      .values({
        title: lead.title,
        status: "open",
        streetAddress: lead.streetAddress,
        city: lead.city,
        state: lead.state,
        zipCode: lead.zipCode,
        contractPrice: lead.estimatedRevenueMax ?? lead.estimatedRevenueMin,
        jobType: lead.projectType,
        projectedStart: lead.projectedSalesDate,
        workDays: ["mon", "tue", "wed", "thu", "fri"],
        createdBy: req.auth.userId,
      })
      .returning();

    await ensureSystemFolders(job.id);

    await db
      .update(leads)
      .set({
        status: "won",
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    if (lead.status !== "won") {
      emitRealtimeEvent("lead:status-changed", {
        id: leadId,
        title: lead.title,
        previousStatus: lead.status,
        status: "won",
      }, leadId);
    }

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "converted_to_job",
      userId: req.auth.userId,
      jobId: job.id,
      description: `Converted lead ${lead.title} to job ${job.title}`,
      extra: {
        leadId,
        convertedJobId: job.id,
      },
    });

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
    await assertCanManageLead(req.auth, leadId);
    await getLeadOrThrow(leadId);

    await writeActivity({
      entityType: "lead",
      entityId: leadId,
      action: "activity_logged",
      userId: req.auth.userId,
      jobId: leadId,
      description: body.data.notes
        ? `${body.data.title}: ${body.data.notes}`
        : body.data.title,
      extra: {
        leadId,
      },
    });

    res.status(201).json({ success: true });
  }),
);

export default router;
