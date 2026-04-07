import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  files,
  folders,
  jobs,
  leadContacts,
  leads,
  scheduleItems,
} from "@workspace/db/schema";
import { HttpError, asyncHandler } from "../lib/http";

const router: IRouter = Router();

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().positive().max(10).optional().default(10),
});

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const query = querySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid search query.", query.error.flatten());
    }

    const search = `%${query.data.q}%`;
    const limit = query.data.limit;

    const [jobRows, leadRows, contactLeadRows, fileRows, scheduleRows] = await Promise.all([
      db
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
            or(
              ilike(jobs.title, search),
              ilike(jobs.streetAddress, search),
              ilike(jobs.city, search),
              ilike(jobs.state, search),
            ),
          ),
        )
        .orderBy(desc(jobs.updatedAt), asc(jobs.title))
        .limit(limit),
      db
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
            or(
              ilike(leads.title, search),
              ilike(leads.city, search),
              ilike(leads.state, search),
              ilike(leads.projectType, search),
            ),
          ),
        )
        .orderBy(desc(leads.updatedAt), asc(leads.title))
        .limit(limit),
      db
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
            or(
              ilike(leadContacts.displayName, search),
              ilike(leadContacts.email, search),
              ilike(leadContacts.phone, search),
              ilike(leadContacts.cellPhone, search),
            ),
          ),
        )
        .orderBy(asc(leadContacts.displayName))
        .limit(limit),
      db
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
            or(ilike(files.originalName, search), ilike(files.filename, search)),
          ),
        )
        .orderBy(desc(files.updatedAt), asc(files.originalName))
        .limit(limit),
      db
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
            ilike(scheduleItems.title, search),
          ),
        )
        .orderBy(desc(scheduleItems.updatedAt), asc(scheduleItems.title))
        .limit(limit),
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

    const results = [
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
      ...fileRows.map((file) => ({
        id: file.id,
        type: "file" as const,
        title: file.originalName,
        subtitle: `${file.jobTitle} • ${file.folderTitle}`,
        href: `/jobs/${file.jobId}/files/${file.mediaType === "document" ? "documents" : `${file.mediaType}s`}?folder=${file.folderId}`,
      })),
      ...scheduleRows.map((item) => ({
        id: item.id,
        type: "schedule" as const,
        title: item.title,
        subtitle: `${item.jobTitle} • ${item.startDate} to ${item.endDate}`,
        href: `/jobs/${item.jobId}/schedule?item=${item.id}`,
      })),
    ].slice(0, limit);

    res.json({ results });
  }),
);

export default router;
