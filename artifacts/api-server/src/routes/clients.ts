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
} from "drizzle-orm";
import { z } from "zod";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { clientContacts, clients, jobs, users } from "@workspace/db/schema";
import { HttpError, asyncHandler } from "../lib/http";

const router: IRouter = Router();

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const clientListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().trim().optional(),
});

const clientPayloadSchema = z.object({
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

const contactPayloadSchema = z.object({
  firstName: optionalString,
  lastName: optionalString,
  title: optionalString,
  email: optionalString,
  phone: optionalString,
  cellPhone: optionalString,
  isPrimary: z.boolean().optional().default(false),
});

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new HttpError(400, `Missing ${label}.`);
  return normalized;
}

async function getClientOrThrow(id: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) throw new HttpError(404, "Client not found.");
  return client;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = clientListQuerySchema.safeParse(req.query);
    if (!query.success) throw new HttpError(400, "Invalid query.", query.error.flatten());

    const { page, pageSize, search } = query.data;
    const offset = (page - 1) * pageSize;

    const conditions = [isNull(clients.deletedAt)];
    if (search) {
      const like = `%${search}%`;
      conditions.push(
        or(
          ilike(clients.companyName, like),
          ilike(clients.email, like),
          ilike(clients.city, like),
        )!,
      );
    }

    const whereClause = and(...conditions);

    const [totalRow] = await db
      .select({ total: count() })
      .from(clients)
      .where(whereClause);

    const rows = await db
      .select({
        id: clients.id,
        companyName: clients.companyName,
        phone: clients.phone,
        email: clients.email,
        city: clients.city,
        state: clients.state,
        createdAt: clients.createdAt,
      })
      .from(clients)
      .where(whereClause)
      .orderBy(asc(clients.companyName))
      .limit(pageSize)
      .offset(offset);

    const clientIds = rows.map((r) => r.id);

    type ContactRow = {
      clientId: string | null;
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
      isPrimary: boolean | null;
    };
    type JobCountRow = { clientId: string | null; id: string; status: string | null };

    let contactRows: ContactRow[] = [];
    let jobRows: JobCountRow[] = [];

    if (clientIds.length > 0) {
      [contactRows, jobRows] = await Promise.all([
        db
          .select({
            clientId: clientContacts.clientId,
            id: clientContacts.id,
            firstName: clientContacts.firstName,
            lastName: clientContacts.lastName,
            email: clientContacts.email,
            phone: clientContacts.phone,
            isPrimary: clientContacts.isPrimary,
          })
          .from(clientContacts)
          .where(and(isNull(clientContacts.deletedAt), inArray(clientContacts.clientId, clientIds)))
          .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.firstName)),
        db
          .select({
            clientId: jobs.clientId,
            id: jobs.id,
            status: jobs.status,
          })
          .from(jobs)
          .where(and(isNull(jobs.deletedAt), inArray(jobs.clientId, clientIds))),
      ]);
    }

    const contactsByClient: Record<string, typeof contactRows> = {};
    for (const c of contactRows) {
      if (!c.clientId) continue;
      if (!contactsByClient[c.clientId]) contactsByClient[c.clientId] = [];
      contactsByClient[c.clientId].push(c);
    }

    const jobCountByClient: Record<string, number> = {};
    const openJobCountByClient: Record<string, number> = {};
    for (const j of jobRows) {
      if (!j.clientId) continue;
      jobCountByClient[j.clientId] = (jobCountByClient[j.clientId] ?? 0) + 1;
      if (j.status === "open") {
        openJobCountByClient[j.clientId] = (openJobCountByClient[j.clientId] ?? 0) + 1;
      }
    }

    const enriched = rows.map((r) => {
      const contacts = contactsByClient[r.id] ?? [];
      const primary = contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null;
      return {
        ...r,
        primaryContact: primary,
        contactCount: contacts.length,
        jobCount: jobCountByClient[r.id] ?? 0,
        openJobCount: openJobCountByClient[r.id] ?? 0,
      };
    });

    const totalItems = Number(totalRow?.total ?? 0);

    res.json({
      clients: enriched,
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
  asyncHandler(async (req, res) => {
    const body = clientPayloadSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid client payload.", body.error.flatten());

    const [client] = await db
      .insert(clients)
      .values({
        companyName: body.data.companyName,
        phone: body.data.phone,
        email: body.data.email,
        streetAddress: body.data.streetAddress,
        city: body.data.city,
        state: body.data.state,
        zipCode: body.data.zipCode,
        notes: body.data.notes,
        createdBy: req.auth.userId,
      })
      .returning();

    res.status(201).json({ client });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    const client = await getClientOrThrow(clientId);

    const [contacts, jobList] = await Promise.all([
      db
        .select()
        .from(clientContacts)
        .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
        .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.firstName)),
      db
        .select({
          id: jobs.id,
          title: jobs.title,
          status: jobs.status,
          city: jobs.city,
          state: jobs.state,
          jobType: jobs.jobType,
          contractPrice: jobs.contractPrice,
          projectedStart: jobs.projectedStart,
          projectedCompletion: jobs.projectedCompletion,
          createdAt: jobs.createdAt,
        })
        .from(jobs)
        .where(and(eq(jobs.clientId, clientId), isNull(jobs.deletedAt)))
        .orderBy(desc(jobs.createdAt)),
    ]);

    res.json({ client: { ...client, contacts, jobs: jobList } });
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    await getClientOrThrow(clientId);

    const body = clientPayloadSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid client payload.", body.error.flatten());

    const [updated] = await db
      .update(clients)
      .set({
        companyName: body.data.companyName,
        phone: body.data.phone,
        email: body.data.email,
        streetAddress: body.data.streetAddress,
        city: body.data.city,
        state: body.data.state,
        zipCode: body.data.zipCode,
        notes: body.data.notes,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId))
      .returning();

    res.json({ client: updated });
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    await getClientOrThrow(clientId);

    await db
      .update(jobs)
      .set({ clientId: null, updatedAt: new Date() })
      .where(eq(jobs.clientId, clientId));

    await db
      .update(clients)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(clients.id, clientId));

    res.json({ success: true });
  }),
);

router.get(
  "/:id/contacts",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    await getClientOrThrow(clientId);

    const contacts = await db
      .select()
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
      .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.firstName));

    res.json({ contacts });
  }),
);

router.get(
  "/:id/jobs",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    await getClientOrThrow(clientId);

    const jobList = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        status: jobs.status,
        city: jobs.city,
        state: jobs.state,
        jobType: jobs.jobType,
        contractPrice: jobs.contractPrice,
        projectedStart: jobs.projectedStart,
        projectedCompletion: jobs.projectedCompletion,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .where(and(eq(jobs.clientId, clientId), isNull(jobs.deletedAt)))
      .orderBy(desc(jobs.createdAt));

    res.json({ jobs: jobList });
  }),
);

router.post(
  "/:id/contacts",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    await getClientOrThrow(clientId);

    const body = contactPayloadSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid contact payload.", body.error.flatten());

    if (body.data.isPrimary) {
      await db
        .update(clientContacts)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)));
    }

    const [contact] = await db
      .insert(clientContacts)
      .values({
        clientId,
        firstName: body.data.firstName,
        lastName: body.data.lastName,
        title: body.data.title,
        email: body.data.email,
        phone: body.data.phone,
        cellPhone: body.data.cellPhone,
        isPrimary: body.data.isPrimary,
      })
      .returning();

    res.status(201).json({ contact });
  }),
);

router.put(
  "/:id/contacts/:contactId",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    const contactId = getParam(req.params.contactId, "contact id");
    await getClientOrThrow(clientId);

    const [existing] = await db
      .select()
      .from(clientContacts)
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
      .limit(1);
    if (!existing) throw new HttpError(404, "Contact not found.");

    const body = contactPayloadSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid contact payload.", body.error.flatten());

    if (body.data.isPrimary) {
      await db
        .update(clientContacts)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)));
    }

    const [updated] = await db
      .update(clientContacts)
      .set({
        firstName: body.data.firstName,
        lastName: body.data.lastName,
        title: body.data.title,
        email: body.data.email,
        phone: body.data.phone,
        cellPhone: body.data.cellPhone,
        isPrimary: body.data.isPrimary,
        updatedAt: new Date(),
      })
      .where(eq(clientContacts.id, contactId))
      .returning();

    res.json({ contact: updated });
  }),
);

router.delete(
  "/:id/contacts/:contactId",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    const contactId = getParam(req.params.contactId, "contact id");
    await getClientOrThrow(clientId);

    const [existing] = await db
      .select()
      .from(clientContacts)
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
      .limit(1);
    if (!existing) throw new HttpError(404, "Contact not found.");

    await db
      .update(clientContacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(clientContacts.id, contactId));

    res.json({ success: true });
  }),
);

export default router;
