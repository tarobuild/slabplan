import { and, asc, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  clients,
  files,
  folders,
  jobs,
  leadContacts,
  leads,
  scheduleItems,
} from "@workspace/db/schema";
import {
  assertCanViewFolder,
  assertCanViewScheduleItem,
  listAccessibleClientIds,
  listAccessibleJobIds,
  listAccessibleLeadIds,
} from "../lib/authorization";
import { HttpError, asyncHandler } from "../lib/http";
import { buildContainsLikePattern } from "../lib/search";

const router: IRouter = Router();

const MAX_PAGE_SIZE = 25;
const MAX_PAGE = 20;
const MAX_PER_SOURCE_FETCH = 200;

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  page: z.coerce.number().int().positive().max(MAX_PAGE).optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .optional()
    .default(10),
});

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const query = querySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid search query.", query.error.flatten());
    }

    const search = buildContainsLikePattern(query.data.q);
    const { page, pageSize } = query.data;
    const offset = (page - 1) * pageSize;
    const endIndex = offset + pageSize;
    // Fetch enough rows from each source to cover the requested page plus a
    // lookahead row used to compute `hasMore`. We bound per-source fetches so
    // a query that matches every row in a giant table cannot blow up memory.
    const queryLimit = Math.min(endIndex + 1, MAX_PER_SOURCE_FETCH);

    const [accessibleJobIds, accessibleLeadIds, accessibleClientIds] = await Promise.all([
      listAccessibleJobIds(req.auth!),
      listAccessibleLeadIds(req.auth!),
      listAccessibleClientIds(req.auth!),
    ]);

    const noJobAccess = accessibleJobIds !== null && accessibleJobIds.length === 0;
    const noLeadAccess = accessibleLeadIds !== null && accessibleLeadIds.length === 0;
    const noClientAccess =
      accessibleClientIds !== null && accessibleClientIds.length === 0;

    if (noJobAccess && noLeadAccess && noClientAccess) {
      res.json({
        results: [],
        pagination: { page, pageSize, hasMore: false },
      });
      return;
    }

    const [jobRows, leadRows, contactLeadRows, fileRows, scheduleRows, clientRows] =
      await Promise.all([
      noJobAccess
        ? Promise.resolve([])
        : db
            .select({
              id: jobs.id,
              title: jobs.title,
              streetAddress: jobs.streetAddress,
              city: jobs.city,
              state: jobs.state,
              status: jobs.status,
            })
            .from(jobs)
            .where(
              and(
                isNull(jobs.deletedAt),
                accessibleJobIds ? inArray(jobs.id, accessibleJobIds) : undefined,
                or(
                  ilike(jobs.title, search),
                  ilike(jobs.streetAddress, search),
                  ilike(jobs.city, search),
                  ilike(jobs.state, search),
                ),
              ),
            )
            .orderBy(desc(jobs.updatedAt), asc(jobs.title))
            .limit(queryLimit),
      noLeadAccess
        ? Promise.resolve([])
        : db
            .select({
              id: leads.id,
              title: leads.title,
              city: leads.city,
              state: leads.state,
              status: leads.status,
            })
            .from(leads)
            .where(
              and(
                isNull(leads.deletedAt),
                accessibleLeadIds ? inArray(leads.id, accessibleLeadIds) : undefined,
                or(
                  ilike(leads.title, search),
                  ilike(leads.city, search),
                  ilike(leads.state, search),
                  ilike(leads.projectType, search),
                ),
              ),
            )
            .orderBy(desc(leads.updatedAt), asc(leads.title))
            .limit(queryLimit),
      noLeadAccess
        ? Promise.resolve([])
        : db
            .select({
              leadId: leads.id,
              title: leads.title,
              city: leads.city,
              state: leads.state,
              status: leads.status,
              contactName: leadContacts.displayName,
            })
            .from(leadContacts)
            .innerJoin(leads, eq(leadContacts.leadId, leads.id))
            .where(
              and(
                isNull(leadContacts.deletedAt),
                isNull(leads.deletedAt),
                accessibleLeadIds ? inArray(leads.id, accessibleLeadIds) : undefined,
                or(
                  ilike(leadContacts.displayName, search),
                  ilike(leadContacts.email, search),
                  ilike(leadContacts.phone, search),
                  ilike(leadContacts.cellPhone, search),
                ),
              ),
            )
            .orderBy(asc(leadContacts.displayName))
            .limit(queryLimit),
      noJobAccess
        ? Promise.resolve([])
        : db
            .select({
              id: files.id,
              originalName: files.originalName,
              folderId: folders.id,
              folderTitle: folders.title,
              mediaType: folders.mediaType,
              jobId: jobs.id,
              jobTitle: jobs.title,
            })
            .from(files)
            .innerJoin(folders, eq(files.folderId, folders.id))
            .innerJoin(jobs, eq(folders.jobId, jobs.id))
            .where(
              and(
                isNull(files.deletedAt),
                isNull(folders.deletedAt),
                isNull(jobs.deletedAt),
                accessibleJobIds ? inArray(jobs.id, accessibleJobIds) : undefined,
                or(ilike(files.originalName, search), ilike(files.filename, search)),
              ),
            )
            .orderBy(desc(files.updatedAt), asc(files.originalName))
            .limit(queryLimit),
      noJobAccess
        ? Promise.resolve([])
        : db
            .select({
              id: scheduleItems.id,
              title: scheduleItems.title,
              startDate: scheduleItems.startDate,
              endDate: scheduleItems.endDate,
              jobId: jobs.id,
              jobTitle: jobs.title,
            })
            .from(scheduleItems)
            .innerJoin(jobs, eq(scheduleItems.jobId, jobs.id))
            .where(
              and(
                isNull(scheduleItems.deletedAt),
                isNull(jobs.deletedAt),
                accessibleJobIds ? inArray(jobs.id, accessibleJobIds) : undefined,
                ilike(scheduleItems.title, search),
                or(
                  eq(scheduleItems.isPersonalTodo, false),
                  isNull(scheduleItems.isPersonalTodo),
                  eq(scheduleItems.createdBy, req.auth!.userId),
                ),
              ),
            )
            .orderBy(desc(scheduleItems.updatedAt), asc(scheduleItems.title))
            .limit(queryLimit),
      noClientAccess
        ? Promise.resolve([])
        : db
            .select({
              id: clients.id,
              companyName: clients.companyName,
              email: clients.email,
              phone: clients.phone,
              city: clients.city,
              state: clients.state,
            })
            .from(clients)
            .where(
              and(
                isNull(clients.deletedAt),
                accessibleClientIds
                  ? inArray(clients.id, accessibleClientIds)
                  : undefined,
                or(
                  ilike(clients.companyName, search),
                  ilike(clients.email, search),
                  ilike(clients.phone, search),
                  ilike(clients.streetAddress, search),
                  ilike(clients.city, search),
                  ilike(clients.state, search),
                ),
              ),
            )
            .orderBy(desc(clients.updatedAt), asc(clients.companyName))
            .limit(queryLimit),
    ]);

    const [visibleFileRows, visibleScheduleRows] = await Promise.all([
      Promise.all(
        fileRows.map(async (file) => {
          try {
            await assertCanViewFolder(req.auth!, file.folderId);
            return file;
          } catch (error) {
            if (error instanceof HttpError && error.statusCode === 403) {
              return null;
            }

            throw error;
          }
        }),
      ).then((rows) => rows.filter((row): row is NonNullable<typeof row> => row !== null)),
      Promise.all(
        scheduleRows.map(async (item) => {
          try {
            await assertCanViewScheduleItem(req.auth!, item.id);
            return item;
          } catch (error) {
            if (error instanceof HttpError && error.statusCode === 403) {
              return null;
            }

            throw error;
          }
        }),
      ).then((rows) => rows.filter((row): row is NonNullable<typeof row> => row !== null)),
    ]);

    const leadMap = new Map<
      string,
      {
        id: string;
        title: string;
        city: string | null;
        state: string | null;
        status: string;
        contactName: string | null;
      }
    >();

    for (const lead of leadRows) {
      leadMap.set(lead.id, {
        ...lead,
        contactName: null,
      });
    }

    for (const contactLead of contactLeadRows) {
      if (!leadMap.has(contactLead.leadId)) {
        leadMap.set(contactLead.leadId, {
          id: contactLead.leadId,
          title: contactLead.title,
          city: contactLead.city,
          state: contactLead.state,
          status: contactLead.status,
          contactName: contactLead.contactName,
        });
        continue;
      }

      const existing = leadMap.get(contactLead.leadId);

      if (existing && !existing.contactName) {
        existing.contactName = contactLead.contactName;
      }
    }

    const merged = [
      ...jobRows.map((job) => ({
        id: job.id,
        type: "job" as const,
        title: job.title,
        subtitle:
          [job.streetAddress, job.city, job.state].filter(Boolean).join(", ") ||
          `Status: ${job.status.replaceAll("_", " ")}`,
        href: `/jobs/${job.id}`,
      })),
      ...Array.from(leadMap.values()).map((lead) => ({
        id: lead.id,
        type: "lead" as const,
        title: lead.title,
        subtitle:
          lead.contactName ||
          [lead.city, lead.state].filter(Boolean).join(", ") ||
          `Status: ${lead.status.replaceAll("_", " ")}`,
        href: `/sales/leads?lead=${lead.id}`,
      })),
      ...visibleFileRows.map((file) => ({
        id: file.id,
        type: "file" as const,
        title: file.originalName,
        subtitle: `${file.jobTitle} • ${file.folderTitle}`,
        href: `/jobs/${file.jobId}/files/${file.mediaType === "document" ? "documents" : `${file.mediaType}s`}?folder=${file.folderId}`,
      })),
      ...visibleScheduleRows.map((item) => ({
        id: item.id,
        type: "schedule" as const,
        title: item.title,
        subtitle: `${item.jobTitle} • ${item.startDate} to ${item.endDate}`,
        href: `/jobs/${item.jobId}/schedule?item=${item.id}`,
      })),
      ...clientRows.map((client) => ({
        id: client.id,
        type: "client" as const,
        title: client.companyName,
        subtitle:
          [client.city, client.state].filter(Boolean).join(", ") ||
          client.email ||
          client.phone ||
          "Client",
        href: `/clients?client=${client.id}`,
      })),
    ];

    const results = merged.slice(offset, endIndex);
    const hasMore = page < MAX_PAGE && merged.length > endIndex;

    res.json({
      results,
      pagination: { page, pageSize, hasMore },
    });
  }),
);

export default router;
