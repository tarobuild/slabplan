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
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { clientContacts, clients, jobs, users } from "@workspace/db/schema";
import {
  assertCanAccessClient,
  assertCanManageClient,
  listAccessibleClientIds,
  listAccessibleJobIds,
} from "../lib/authorization";
import { HttpError, asyncHandler } from "../lib/http";
import { buildContainsLikePattern } from "../lib/search";
import {
  requireAdmin,
  requireManagerOrAbove,
} from "../middleware/require-auth";
import { getTrackerTotalsByJobIds } from "./financials";

const router: IRouter = Router();

router.use(requireManagerOrAbove);

// Deterministic UUIDv5 sentinel (derived from `cadstone:unknown-client`
// in the DNS namespace) for the "Unknown client" placeholder created
// by migration 0010. Jobs without a real client (legacy NULL rows or
// rows orphaned by a client deletion) are assigned to this client so
// the clients-first navigation always has somewhere to land. Must stay
// identical across every environment so migration 0010 and the runtime
// reference the same row. SAST scanners flag the high-entropy hex
// string as a "Generic API Key"; it is a row id, not a credential.
// hounddog-ignore: hardcoded-secret
// nosemgrep: vendored-rules.generic.secrets.gitleaks.generic-api-key
const UNKNOWN_CLIENT_ID = "8bdd2d52-7563-5843-95f8-aea786f0b386"; // nosemgrep: vendored-rules.generic.secrets.gitleaks.generic-api-key

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
  status: z.enum(["active", "archived", "all"]).optional().default("active"),
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

// Detail variant that allows opening archived (soft-deleted) clients so
// the Archived/All chips can navigate into the same Client Detail page.
async function getClientForDetail(id: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  if (!client) throw new HttpError(404, "Client not found.");
  return client;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = clientListQuerySchema.safeParse(req.query);
    if (!query.success)
      throw new HttpError(400, "Invalid query.", query.error.flatten());

    const { page, pageSize, search, status } = query.data;
    const offset = (page - 1) * pageSize;
    const [accessibleClientIds, accessibleJobIds] = await Promise.all([
      listAccessibleClientIds(req.auth!),
      listAccessibleJobIds(req.auth!),
    ]);

    if (accessibleClientIds && accessibleClientIds.length === 0) {
      res.json({
        clients: [],
        pagination: {
          page,
          pageSize,
          totalItems: 0,
          totalPages: 1,
        },
      });
      return;
    }

    // Status filter (simplified to match user mental model — a client is
    // Active unless it has been explicitly archived/soft-deleted):
    //   active   → not soft-deleted (includes brand-new clients with no jobs)
    //   archived → soft-deleted only
    //   all      → no status filter
    const conditions: SQL[] = [];
    if (status === "active") {
      conditions.push(isNull(clients.deletedAt));
    } else if (status === "archived") {
      conditions.push(sql`${clients.deletedAt} is not null`);
    }
    if (accessibleClientIds) {
      conditions.push(inArray(clients.id, accessibleClientIds));
    }
    if (search) {
      const like = buildContainsLikePattern(search);
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
        deletedAt: clients.deletedAt,
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
    type JobCountRow = {
      clientId: string | null;
      id: string;
      status: string | null;
      contractValueCents: number | null;
      amountPaidCents: number | null;
      updatedAt: Date | null;
    };

    let contactRows: ContactRow[] = [];
    let jobRows: JobCountRow[] = [];

    if (clientIds.length > 0) {
      const jobRowsPromise =
        accessibleJobIds !== null && accessibleJobIds.length === 0
          ? Promise.resolve([])
          : db
              .select({
                clientId: jobs.clientId,
                id: jobs.id,
                status: jobs.status,
                contractValueCents: jobs.contractValueCents,
                amountPaidCents: jobs.amountPaidCents,
                updatedAt: jobs.updatedAt,
              })
              .from(jobs)
              .where(
                and(
                  isNull(jobs.deletedAt),
                  inArray(jobs.clientId, clientIds),
                  accessibleJobIds
                    ? inArray(jobs.id, accessibleJobIds)
                    : undefined,
                ),
              );

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
          .where(
            and(
              isNull(clientContacts.deletedAt),
              inArray(clientContacts.clientId, clientIds),
            ),
          )
          .orderBy(
            desc(clientContacts.isPrimary),
            asc(clientContacts.firstName),
          ),
        jobRowsPromise,
      ]);
    }

    const contactsByClient: Record<string, typeof contactRows> = {};
    for (const c of contactRows) {
      if (!c.clientId) continue;
      if (!contactsByClient[c.clientId]) contactsByClient[c.clientId] = [];
      contactsByClient[c.clientId].push(c);
    }

    // Per-job tracker totals (Task #269). When a job has a financial
    // tracker, the SOV-derived contract and billed numbers replace the
    // legacy job-level money fields in the client AR rollup.
    const allJobIds = jobRows.map((j) => j.id);
    const trackerTotals = await getTrackerTotalsByJobIds(allJobIds);

    type Rollup = {
      total: number;
      active: number;
      contract: number;
      paid: number;
      lastActivityAt: Date | null;
    };
    const rollupByClient: Record<string, Rollup> = {};
    for (const j of jobRows) {
      if (!j.clientId) continue;
      const r = (rollupByClient[j.clientId] ??= {
        total: 0,
        active: 0,
        contract: 0,
        paid: 0,
        lastActivityAt: null,
      });
      r.total += 1;
      if (j.status !== "archived" && j.status !== "closed") r.active += 1;
      const tt = trackerTotals.get(j.id);
      if (tt) {
        r.contract += tt.contractWithChangesCents;
        r.paid += tt.netReceivedCents;
      } else {
        if (typeof j.contractValueCents === "number")
          r.contract += j.contractValueCents;
        if (typeof j.amountPaidCents === "number") r.paid += j.amountPaidCents;
      }
      if (
        j.updatedAt &&
        (!r.lastActivityAt || j.updatedAt > r.lastActivityAt)
      ) {
        r.lastActivityAt = j.updatedAt;
      }
    }

    const enriched = rows.map((r) => {
      const contacts = contactsByClient[r.id] ?? [];
      const primary = contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null;
      const roll = rollupByClient[r.id];
      const contract = roll?.contract ?? 0;
      const paid = roll?.paid ?? 0;
      return {
        ...r,
        primaryContact: primary,
        contactCount: contacts.length,
        jobCount: roll?.total ?? 0,
        openJobCount: roll?.active ?? 0,
        activeJobCount: roll?.active ?? 0,
        totalJobCount: roll?.total ?? 0,
        contractValueCents: contract,
        amountPaidCents: paid,
        outstandingCents: Math.max(0, contract - paid),
        lastActivityAt: roll?.lastActivityAt ?? null,
        archived: r.deletedAt !== null,
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
    if (!body.success)
      throw new HttpError(400, "Invalid client payload.", body.error.flatten());

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
        createdBy: req.auth!.userId,
      })
      .returning();

    res.status(201).json({ client });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    await assertCanAccessClient(req.auth!, clientId);
    const client = await getClientForDetail(clientId);
    const accessibleJobIds = await listAccessibleJobIds(req.auth!);

    const [contacts, jobList] = await Promise.all([
      db
        .select()
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clientId, clientId),
            isNull(clientContacts.deletedAt),
          ),
        )
        .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.firstName)),
      accessibleJobIds !== null && accessibleJobIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: jobs.id,
              title: jobs.title,
              status: jobs.status,
              city: jobs.city,
              state: jobs.state,
              jobType: jobs.jobType,
              contractPrice: jobs.contractPrice,
              contractValueCents: jobs.contractValueCents,
              amountPaidCents: jobs.amountPaidCents,
              projectedStart: jobs.projectedStart,
              projectedCompletion: jobs.projectedCompletion,
              actualStart: jobs.actualStart,
              actualCompletion: jobs.actualCompletion,
              projectManagerId: jobs.projectManagerId,
              projectManagerName: users.fullName,
              updatedAt: jobs.updatedAt,
              createdAt: jobs.createdAt,
            })
            .from(jobs)
            .leftJoin(users, eq(jobs.projectManagerId, users.id))
            .where(
              and(
                eq(jobs.clientId, clientId),
                isNull(jobs.deletedAt),
                accessibleJobIds
                  ? inArray(jobs.id, accessibleJobIds)
                  : undefined,
              ),
            )
            .orderBy(desc(jobs.createdAt)),
    ]);

    const detailJobIds = jobList.map((j) => j.id);
    const detailTrackers = await getTrackerTotalsByJobIds(detailJobIds);

    let contractTotal = 0;
    let paidTotal = 0;
    let activeJobCount = 0;
    let lastActivityAt: Date | null = null;
    const enrichedJobs = jobList.map((j) => {
      const tt = detailTrackers.get(j.id);
      if (j.status !== "archived" && j.status !== "closed") activeJobCount += 1;
      const contract = tt
        ? tt.contractWithChangesCents
        : typeof j.contractValueCents === "number"
          ? j.contractValueCents
          : 0;
      const paid = tt
        ? tt.netReceivedCents
        : typeof j.amountPaidCents === "number"
          ? j.amountPaidCents
          : 0;
      contractTotal += contract;
      paidTotal += paid;
      if (j.updatedAt && (!lastActivityAt || j.updatedAt > lastActivityAt)) {
        lastActivityAt = j.updatedAt;
      }
      return {
        ...j,
        contractValueCents: contract,
        amountPaidCents: paid,
        hasTracker: tt !== undefined,
      };
    });
    const rollups = {
      contractValueCents: contractTotal,
      amountPaidCents: paidTotal,
      outstandingCents: Math.max(0, contractTotal - paidTotal),
      activeJobCount,
      totalJobCount: jobList.length,
      lastActivityAt,
    };

    res.json({
      client: {
        ...client,
        archived: client.deletedAt !== null,
        contacts,
        jobs: enrichedJobs,
        rollups,
      },
    });
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    await assertCanManageClient(req.auth!, clientId);
    await getClientOrThrow(clientId);

    const body = clientPayloadSchema.safeParse(req.body);
    if (!body.success)
      throw new HttpError(400, "Invalid client payload.", body.error.flatten());

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
  requireAdmin,
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    // Task #277 audit item 2: belt-and-suspenders ownership check.
    // requireAdmin already gates the route on role, but this second
    // call enforces the per-resource visibility predicate consistently
    // with every other client mutation (PATCH, contacts, etc.). Pinned
    // by `audit-fixes.test.ts` so a future regression that drops it
    // surfaces immediately.
    await assertCanAccessClient(req.auth!, clientId);
    await getClientOrThrow(clientId);

    const now = new Date();

    if (clientId === UNKNOWN_CLIENT_ID) {
      throw new HttpError(
        400,
        "The Unknown client placeholder cannot be deleted.",
      );
    }

    await db.transaction(async (tx) => {
      // Reassign live jobs to the Unknown client placeholder so they
      // remain reachable through the clients-first navigation instead
      // of being orphaned with a NULL client_id.
      await tx
        .update(jobs)
        .set({ clientId: UNKNOWN_CLIENT_ID, updatedAt: now })
        .where(and(eq(jobs.clientId, clientId), isNull(jobs.deletedAt)));

      await tx
        .update(clientContacts)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(clientContacts.clientId, clientId),
            isNull(clientContacts.deletedAt),
          ),
        );

      await tx
        .update(clients)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(clients.id, clientId));
    });

    res.json({ success: true });
  }),
);

router.get(
  "/:id/contacts",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    await assertCanAccessClient(req.auth!, clientId);
    await getClientOrThrow(clientId);

    const contacts = await db
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clientId, clientId),
          isNull(clientContacts.deletedAt),
        ),
      )
      .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.firstName));

    res.json({ contacts });
  }),
);

router.get(
  "/:id/jobs",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    await assertCanAccessClient(req.auth!, clientId);
    await getClientOrThrow(clientId);
    const accessibleJobIds = await listAccessibleJobIds(req.auth!);

    const jobList =
      accessibleJobIds !== null && accessibleJobIds.length === 0
        ? []
        : await db
            .select({
              id: jobs.id,
              title: jobs.title,
              status: jobs.status,
              city: jobs.city,
              state: jobs.state,
              streetAddress: jobs.streetAddress,
              zipCode: jobs.zipCode,
              jobType: jobs.jobType,
              contractType: jobs.contractType,
              contractPrice: jobs.contractPrice,
              contractValueCents: jobs.contractValueCents,
              amountPaidCents: jobs.amountPaidCents,
              projectedStart: jobs.projectedStart,
              projectedCompletion: jobs.projectedCompletion,
              actualStart: jobs.actualStart,
              actualCompletion: jobs.actualCompletion,
              workDays: jobs.workDays,
              squareFeet: jobs.squareFeet,
              permitNumber: jobs.permitNumber,
              clientId: jobs.clientId,
              clientName: clients.companyName,
              projectManagerId: jobs.projectManagerId,
              updatedAt: jobs.updatedAt,
              createdAt: jobs.createdAt,
            })
            .from(jobs)
            .leftJoin(clients, eq(jobs.clientId, clients.id))
            .where(
              and(
                eq(jobs.clientId, clientId),
                isNull(jobs.deletedAt),
                accessibleJobIds
                  ? inArray(jobs.id, accessibleJobIds)
                  : undefined,
              ),
            )
            .orderBy(desc(jobs.createdAt));

    res.json({ jobs: jobList });
  }),
);

router.get(
  "/:id/contacts/:contactId",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    const contactId = getParam(req.params.contactId, "contact id");
    await assertCanAccessClient(req.auth!, clientId);
    await getClientOrThrow(clientId);

    const [contact] = await db
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, contactId),
          eq(clientContacts.clientId, clientId),
          isNull(clientContacts.deletedAt),
        ),
      )
      .limit(1);
    if (!contact) throw new HttpError(404, "Contact not found.");

    res.json({ contact });
  }),
);

router.post(
  "/:id/contacts",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    await assertCanManageClient(req.auth!, clientId);
    await getClientOrThrow(clientId);

    const body = contactPayloadSchema.safeParse(req.body);
    if (!body.success)
      throw new HttpError(
        400,
        "Invalid contact payload.",
        body.error.flatten(),
      );

    const [contact] = await db.transaction(async (tx) => {
      if (body.data.isPrimary) {
        await tx
          .update(clientContacts)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(clientContacts.clientId, clientId),
              isNull(clientContacts.deletedAt),
            ),
          );
      }

      return tx
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
    });

    res.status(201).json({ contact });
  }),
);

router.put(
  "/:id/contacts/:contactId",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    const contactId = getParam(req.params.contactId, "contact id");
    await assertCanManageClient(req.auth!, clientId);
    await getClientOrThrow(clientId);

    const [existing] = await db
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, contactId),
          eq(clientContacts.clientId, clientId),
          isNull(clientContacts.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) throw new HttpError(404, "Contact not found.");

    const body = contactPayloadSchema.safeParse(req.body);
    if (!body.success)
      throw new HttpError(
        400,
        "Invalid contact payload.",
        body.error.flatten(),
      );

    const [updated] = await db.transaction(async (tx) => {
      if (body.data.isPrimary) {
        await tx
          .update(clientContacts)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(clientContacts.clientId, clientId),
              isNull(clientContacts.deletedAt),
            ),
          );
      }

      return tx
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
    });

    res.json({ contact: updated });
  }),
);

router.delete(
  "/:id/contacts/:contactId",
  asyncHandler(async (req, res) => {
    const clientId = getParam(req.params.id, "client id");
    const contactId = getParam(req.params.contactId, "contact id");
    await assertCanManageClient(req.auth!, clientId);
    await getClientOrThrow(clientId);

    const [existing] = await db
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, contactId),
          eq(clientContacts.clientId, clientId),
          isNull(clientContacts.deletedAt),
        ),
      )
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
