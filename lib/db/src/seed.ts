import bcrypt from "bcrypt";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./index";
import {
  activityLog,
  dailyLogAttachments,
  dailyLogTags,
  dailyLogs,
  files,
  folders,
  jobs,
  leadAttachments,
  leadContacts,
  leadSalespeople,
  leadSources,
  leadTags,
  leads,
  scheduleItemAssignees,
  scheduleItems,
  users,
} from "./schema";

export const DEFAULT_SEED_PASSWORD = "Cadstone123!";

export const SEED_USERS = [
  {
    email: "cruz.martinez@cadstone.internal",
    fullName: "Cruz Martinez",
    role: "admin",
    phone: "(303) 555-0101",
  },
  {
    email: "maria.garcia@cadstone.internal",
    fullName: "Maria Garcia",
    role: "project_manager",
    phone: "(303) 555-0113",
  },
  {
    email: "jake.thompson@cadstone.internal",
    fullName: "Jake Thompson",
    role: "crew_member",
    phone: "(303) 555-0148",
  },
] as const;

type SeedUser = (typeof SEED_USERS)[number];
type SeededUserMap = Record<SeedUser["email"], { id: string; fullName: string }>;

type SeedJobRecord = {
  title: string;
  status: string;
  city: string;
  state: string;
  jobType: string;
  contractPrice: string;
  streetAddress: string;
  zipCode: string;
  projectedStart: string;
  projectedCompletion: string;
  workDays: string[];
  createdByEmail: SeedUser["email"];
};

type SeedLeadRecord = {
  title: string;
  city: string;
  state: string;
  streetAddress: string;
  zipCode: string;
  confidence: number;
  projectedSalesDate: string;
  estimatedRevenueMin: string;
  estimatedRevenueMax: string;
  status: string;
  projectType: string;
  notes: string;
  leadSource: string;
  createdByEmail: SeedUser["email"];
};

const seedJobs: SeedJobRecord[] = [
  {
    title: "Smith Kitchen Remodel",
    status: "open",
    city: "Denver",
    state: "CO",
    jobType: "kitchen_countertops",
    contractPrice: "24500.00",
    streetAddress: "1821 S Clayton St",
    zipCode: "80210",
    projectedStart: "2026-04-12",
    projectedCompletion: "2026-04-24",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    createdByEmail: "maria.garcia@cadstone.internal",
  },
  {
    title: "Johnson Master Bath",
    status: "open",
    city: "Boulder",
    state: "CO",
    jobType: "custom",
    contractPrice: "18900.00",
    streetAddress: "945 Pine St",
    zipCode: "80302",
    projectedStart: "2026-04-15",
    projectedCompletion: "2026-04-28",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    createdByEmail: "maria.garcia@cadstone.internal",
  },
  {
    title: "Park Place Lobby",
    status: "open",
    city: "Aurora",
    state: "CO",
    jobType: "flooring",
    contractPrice: "97250.00",
    streetAddress: "450 Park Ave W",
    zipCode: "80012",
    projectedStart: "2026-04-20",
    projectedCompletion: "2026-05-18",
    workDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    createdByEmail: "cruz.martinez@cadstone.internal",
  },
  {
    title: "Riverside Condos Unit 4B",
    status: "closed",
    city: "Lakewood",
    state: "CO",
    jobType: "backsplash",
    contractPrice: "11200.00",
    streetAddress: "2215 W 13th Ave Unit 4B",
    zipCode: "80214",
    projectedStart: "2026-03-08",
    projectedCompletion: "2026-03-18",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    createdByEmail: "maria.garcia@cadstone.internal",
  },
  {
    title: "Chen Outdoor Kitchen",
    status: "archived",
    city: "Littleton",
    state: "CO",
    jobType: "custom",
    contractPrice: "35800.00",
    streetAddress: "10712 W Cooper Dr",
    zipCode: "80127",
    projectedStart: "2026-02-02",
    projectedCompletion: "2026-02-21",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    createdByEmail: "cruz.martinez@cadstone.internal",
  },
];

const seedLeads: SeedLeadRecord[] = [
  {
    title: "Williams Fireplace Surround",
    city: "Denver",
    state: "CO",
    streetAddress: "3612 E 8th Ave",
    zipCode: "80206",
    confidence: 60,
    projectedSalesDate: "2026-04-22",
    estimatedRevenueMin: "12000.00",
    estimatedRevenueMax: "15800.00",
    status: "open",
    projectType: "custom",
    notes:
      "Client wants a limestone surround with a slim hearth. Waiting on final stone selection and template approval.",
    leadSource: "Referral",
    createdByEmail: "cruz.martinez@cadstone.internal",
  },
  {
    title: "Davis Full Home Renovation",
    city: "Centennial",
    state: "CO",
    streetAddress: "7284 E Fair Ave",
    zipCode: "80111",
    confidence: 80,
    projectedSalesDate: "2026-04-18",
    estimatedRevenueMin: "48500.00",
    estimatedRevenueMax: "62000.00",
    status: "in_negotiation",
    projectType: "countertops",
    notes:
      "Multi-room scope covering kitchen, bar, and two bath vanities. Contractor requested phased install pricing.",
    leadSource: "Google Ads",
    createdByEmail: "maria.garcia@cadstone.internal",
  },
  {
    title: "Brown Office Reception",
    city: "Aurora",
    state: "CO",
    streetAddress: "15400 E Alameda Pkwy",
    zipCode: "80017",
    confidence: 100,
    projectedSalesDate: "2026-03-30",
    estimatedRevenueMin: "21000.00",
    estimatedRevenueMax: "24500.00",
    status: "won",
    projectType: "custom",
    notes:
      "Reception desk cladding approved. Pending job conversion after final site measure package is signed.",
    leadSource: "Architect Referral",
    createdByEmail: "cruz.martinez@cadstone.internal",
  },
];

async function upsertUser(user: SeedUser, passwordHash: string) {
  const [row] = await db
    .insert(users)
    .values({
      email: user.email,
      fullName: user.fullName,
      passwordHash,
      phone: user.phone,
      role: user.role,
    })
    .onConflictDoUpdate({
      target: users.email,
      targetWhere: sql`${users.deletedAt} IS NULL`,
      set: {
        fullName: user.fullName,
        passwordHash,
        phone: user.phone,
        role: user.role,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
    });

  return row;
}

async function upsertJob(record: SeedJobRecord, userMap: SeededUserMap) {
  const existing = await db
    .select({
      id: jobs.id,
    })
    .from(jobs)
    .where(and(eq(jobs.title, record.title), isNull(jobs.deletedAt)))
    .limit(1);

  const values = {
    title: record.title,
    status: record.status,
    city: record.city,
    state: record.state,
    streetAddress: record.streetAddress,
    zipCode: record.zipCode,
    contractPrice: record.contractPrice,
    jobType: record.jobType,
    projectedStart: record.projectedStart,
    projectedCompletion: record.projectedCompletion,
    workDays: record.workDays,
    createdBy: userMap[record.createdByEmail].id,
    updatedAt: new Date(),
    deletedAt: null,
  } as const;

  if (existing[0]) {
    const [row] = await db
      .update(jobs)
      .set(values)
      .where(eq(jobs.id, existing[0].id))
      .returning({ id: jobs.id, title: jobs.title });
    return row;
  }

  const [row] = await db.insert(jobs).values(values).returning({
    id: jobs.id,
    title: jobs.title,
  });
  return row;
}

async function upsertLead(record: SeedLeadRecord, userMap: SeededUserMap) {
  const existing = await db
    .select({
      id: leads.id,
    })
    .from(leads)
    .where(and(eq(leads.title, record.title), isNull(leads.deletedAt)))
    .limit(1);

  const values = {
    title: record.title,
    streetAddress: record.streetAddress,
    city: record.city,
    state: record.state,
    zipCode: record.zipCode,
    confidence: record.confidence,
    projectedSalesDate: record.projectedSalesDate,
    estimatedRevenueMin: record.estimatedRevenueMin,
    estimatedRevenueMax: record.estimatedRevenueMax,
    status: record.status,
    projectType: record.projectType,
    notes: record.notes,
    leadSource: record.leadSource,
    createdBy: userMap[record.createdByEmail].id,
    updatedAt: new Date(),
    deletedAt: null,
  } as const;

  if (existing[0]) {
    const [row] = await db
      .update(leads)
      .set(values)
      .where(eq(leads.id, existing[0].id))
      .returning({ id: leads.id, title: leads.title });
    return row;
  }

  const [row] = await db.insert(leads).values(values).returning({
    id: leads.id,
    title: leads.title,
  });
  return row;
}

async function findFolder(params: {
  jobId: string | null;
  title: string;
  mediaType: string;
  parentFolderId?: string | null;
}) {
  const conditions = [
    params.jobId ? eq(folders.jobId, params.jobId) : isNull(folders.jobId),
    eq(folders.title, params.title),
    eq(folders.mediaType, params.mediaType),
    isNull(folders.deletedAt),
    params.parentFolderId
      ? eq(folders.parentFolderId, params.parentFolderId)
      : isNull(folders.parentFolderId),
  ];

  const [existing] = await db
    .select({
      id: folders.id,
      title: folders.title,
    })
    .from(folders)
    .where(and(...conditions))
    .limit(1);

  return existing;
}

async function upsertFolder(params: {
  jobId: string | null;
  title: string;
  mediaType: string;
  isGlobal?: boolean;
  parentFolderId?: string | null;
}) {
  const existing = await findFolder(params);
  const values = {
    jobId: params.jobId ?? sql<string>`null`,
    scope: params.jobId ? "job" : "resource",
    title: params.title,
    mediaType: params.mediaType,
    isGlobal: params.isGlobal ?? false,
    parentFolderId: params.parentFolderId ?? null,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
    updatedAt: new Date(),
    deletedAt: null,
  } as const;

  if (existing) {
    const [row] = await db
      .update(folders)
      .set(values)
      .where(eq(folders.id, existing.id))
      .returning({ id: folders.id, title: folders.title });
    return row;
  }

  const [row] = await db.insert(folders).values(values).returning({
    id: folders.id,
    title: folders.title,
  });
  return row;
}

async function upsertFile(params: {
  folderId: string;
  filename: string;
  originalName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
}) {
  const [existing] = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.folderId, params.folderId), eq(files.filename, params.filename), isNull(files.deletedAt)))
    .limit(1);

  const values = {
    folderId: params.folderId,
    filename: params.filename,
    originalName: params.originalName,
    fileUrl: params.fileUrl,
    mimeType: params.mimeType,
    fileSize: params.fileSize,
    uploadedBy: params.uploadedBy,
    updatedAt: new Date(),
    deletedAt: null,
  } as const;

  if (existing) {
    const [row] = await db
      .update(files)
      .set(values)
      .where(eq(files.id, existing.id))
      .returning({ id: files.id, filename: files.filename });
    return row;
  }

  const [row] = await db.insert(files).values(values).returning({
    id: files.id,
    filename: files.filename,
  });
  return row;
}

async function upsertScheduleItem(params: {
  jobId: string;
  title: string;
  displayColor: string;
  startDate: string;
  endDate: string;
  workDays: number;
  progress: number;
  createdBy: string;
  notes: string;
  assignees: string[];
}) {
  const [existing] = await db
    .select({ id: scheduleItems.id })
    .from(scheduleItems)
    .where(and(eq(scheduleItems.jobId, params.jobId), eq(scheduleItems.title, params.title), isNull(scheduleItems.deletedAt)))
    .limit(1);

  const values = {
    jobId: params.jobId,
    title: params.title,
    displayColor: params.displayColor,
    startDate: params.startDate,
    endDate: params.endDate,
    workDays: params.workDays,
    progress: params.progress,
    notes: params.notes,
    createdBy: params.createdBy,
    updatedAt: new Date(),
    deletedAt: null,
  } as const;

  const row = existing
    ? (
        await db
          .update(scheduleItems)
          .set(values)
          .where(eq(scheduleItems.id, existing.id))
          .returning({ id: scheduleItems.id, title: scheduleItems.title })
      )[0]
    : (
        await db.insert(scheduleItems).values(values).returning({
          id: scheduleItems.id,
          title: scheduleItems.title,
        })
      )[0];

  await db
    .delete(scheduleItemAssignees)
    .where(eq(scheduleItemAssignees.scheduleItemId, row.id));

  if (params.assignees.length > 0) {
    await db.insert(scheduleItemAssignees).values(
      params.assignees.map((userId) => ({
        scheduleItemId: row.id,
        userId,
      })),
    );
  }

  return row;
}

async function upsertDailyLog(params: {
  jobId: string;
  logDate: string;
  title: string;
  notes: string;
  createdBy: string;
  publishedAt: Date;
  weatherData: Record<string, unknown>;
  tags: string[];
  attachmentFileIds: string[];
}) {
  const [existing] = await db
    .select({ id: dailyLogs.id })
    .from(dailyLogs)
    .where(and(eq(dailyLogs.jobId, params.jobId), eq(dailyLogs.logDate, params.logDate), isNull(dailyLogs.deletedAt)))
    .limit(1);

  const values = {
    jobId: params.jobId,
    logDate: params.logDate,
    title: params.title,
    notes: params.notes,
    weatherData: params.weatherData,
    includeWeather: true,
    includeWeatherNotes: true,
    weatherNotes: "Light afternoon wind but no site delays.",
    shareInternalUsers: true,
    shareSubsVendors: false,
    shareClient: false,
    isPrivate: false,
    createdBy: params.createdBy,
    publishedAt: params.publishedAt,
    updatedAt: new Date(),
    deletedAt: null,
  } as const;

  const row = existing
    ? (
        await db
          .update(dailyLogs)
          .set(values)
          .where(eq(dailyLogs.id, existing.id))
          .returning({ id: dailyLogs.id, title: dailyLogs.title })
      )[0]
    : (
        await db.insert(dailyLogs).values(values).returning({
          id: dailyLogs.id,
          title: dailyLogs.title,
        })
      )[0];

  await db.delete(dailyLogTags).where(eq(dailyLogTags.dailyLogId, row.id));
  await db
    .delete(dailyLogAttachments)
    .where(eq(dailyLogAttachments.dailyLogId, row.id));

  if (params.tags.length > 0) {
    await db.insert(dailyLogTags).values(
      params.tags.map((tagName) => ({
        dailyLogId: row.id,
        tagName,
      })),
    );
  }

  if (params.attachmentFileIds.length > 0) {
    await db.insert(dailyLogAttachments).values(
      params.attachmentFileIds.map((fileId) => ({
        dailyLogId: row.id,
        fileId,
      })),
    );
  }

  return row;
}

export async function seedDatabase() {
  await db.execute(sql`select 1`);

  const passwordHash = await bcrypt.hash(DEFAULT_SEED_PASSWORD, 10);
  const userEntries = await Promise.all(SEED_USERS.map((user) => upsertUser(user, passwordHash)));
  const userMap = Object.fromEntries(
    userEntries.map((entry) => [entry.email, { id: entry.id, fullName: entry.fullName }]),
  ) as SeededUserMap;

  const jobEntries = await Promise.all(seedJobs.map((job) => upsertJob(job, userMap)));
  const leadEntries = await Promise.all(seedLeads.map((lead) => upsertLead(lead, userMap)));

  const jobsByTitle = Object.fromEntries(jobEntries.map((job) => [job.title, job]));
  const leadsByTitle = Object.fromEntries(leadEntries.map((lead) => [lead.title, lead]));

  const smithDocs = await upsertFolder({
    jobId: jobsByTitle["Smith Kitchen Remodel"].id,
    title: "Global Documents",
    mediaType: "document",
    isGlobal: true,
  });
  const smithChangeOrders = await upsertFolder({
    jobId: jobsByTitle["Smith Kitchen Remodel"].id,
    title: "Change Orders",
    mediaType: "document",
    parentFolderId: smithDocs.id,
  });
  const smithPhotos = await upsertFolder({
    jobId: jobsByTitle["Smith Kitchen Remodel"].id,
    title: "Install Photos",
    mediaType: "photo",
  });
  const smithVideos = await upsertFolder({
    jobId: jobsByTitle["Smith Kitchen Remodel"].id,
    title: "Global Videos",
    mediaType: "video",
    isGlobal: true,
  });
  const johnsonDocs = await upsertFolder({
    jobId: jobsByTitle["Johnson Master Bath"].id,
    title: "Global Documents",
    mediaType: "document",
    isGlobal: true,
  });
  const johnsonPhotos = await upsertFolder({
    jobId: jobsByTitle["Johnson Master Bath"].id,
    title: "Site Photos",
    mediaType: "photo",
  });
  const brownLeadDocs = await upsertFolder({
    jobId: null,
    title: `Lead ${leadsByTitle["Brown Office Reception"].id} Attachments`,
    mediaType: "document",
  });

  const smithMeasureFile = await upsertFile({
    folderId: smithDocs.id,
    filename: "smith-kitchen-template.pdf",
    originalName: "Smith Kitchen Template.pdf",
    fileUrl: "/uploads/smith-kitchen-template.pdf",
    mimeType: "application/pdf",
    fileSize: 842113,
    uploadedBy: userMap["maria.garcia@cadstone.internal"].id,
  });
  const smithChangeOrderFile = await upsertFile({
    folderId: smithChangeOrders.id,
    filename: "smith-change-order-01.pdf",
    originalName: "Smith Change Order 01.pdf",
    fileUrl: "/uploads/smith-change-order-01.pdf",
    mimeType: "application/pdf",
    fileSize: 401553,
    uploadedBy: userMap["cruz.martinez@cadstone.internal"].id,
  });
  const smithPhotoFile = await upsertFile({
    folderId: smithPhotos.id,
    filename: "smith-demo-day-1.jpg",
    originalName: "Smith Demo Day 1.jpg",
    fileUrl: "/uploads/smith-demo-day-1.jpg",
    mimeType: "image/jpeg",
    fileSize: 1502384,
    uploadedBy: userMap["jake.thompson@cadstone.internal"].id,
  });
  const johnsonPhotoFile = await upsertFile({
    folderId: johnsonPhotos.id,
    filename: "johnson-bath-layout.jpg",
    originalName: "Johnson Bath Layout.jpg",
    fileUrl: "/uploads/johnson-bath-layout.jpg",
    mimeType: "image/jpeg",
    fileSize: 1118740,
    uploadedBy: userMap["maria.garcia@cadstone.internal"].id,
  });
  await upsertFile({
    folderId: smithVideos.id,
    filename: "smith-delivery-walkthrough.mp4",
    originalName: "Smith Delivery Walkthrough.mp4",
    fileUrl: "/uploads/smith-delivery-walkthrough.mp4",
    mimeType: "video/mp4",
    fileSize: 12420884,
    uploadedBy: userMap["jake.thompson@cadstone.internal"].id,
  });
  const johnsonProposalFile = await upsertFile({
    folderId: brownLeadDocs.id,
    filename: "brown-office-reception-proposal.pdf",
    originalName: "Brown Office Reception Proposal.pdf",
    fileUrl: "/uploads/brown-office-reception-proposal.pdf",
    mimeType: "application/pdf",
    fileSize: 968240,
    uploadedBy: userMap["cruz.martinez@cadstone.internal"].id,
  });

  const leadContactsSeed = [
    {
      leadTitle: "Williams Fireplace Surround",
      displayName: "Karen Williams",
      firstName: "Karen",
      lastName: "Williams",
      email: "karen.williams@example.com",
      phone: "(720) 555-0124",
      label: "Homeowner",
    },
    {
      leadTitle: "Davis Full Home Renovation",
      displayName: "Mark Davis",
      firstName: "Mark",
      lastName: "Davis",
      email: "mark.davis@example.com",
      phone: "(720) 555-0165",
      label: "General Contractor",
    },
    {
      leadTitle: "Brown Office Reception",
      displayName: "Tina Brown",
      firstName: "Tina",
      lastName: "Brown",
      email: "tina.brown@example.com",
      phone: "(720) 555-0197",
      label: "Office Manager",
    },
  ] as const;

  for (const contact of leadContactsSeed) {
    const leadId = leadsByTitle[contact.leadTitle].id;
    const [existing] = await db
      .select({ id: leadContacts.id })
      .from(leadContacts)
      .where(and(eq(leadContacts.leadId, leadId), eq(leadContacts.email, contact.email), isNull(leadContacts.deletedAt)))
      .limit(1);

    const values = {
      leadId,
      displayName: contact.displayName,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      label: contact.label,
      updatedAt: new Date(),
      deletedAt: null,
    } as const;

    if (existing) {
      await db.update(leadContacts).set(values).where(eq(leadContacts.id, existing.id));
    } else {
      await db.insert(leadContacts).values(values);
    }
  }

  await db
    .insert(leadSalespeople)
    .values([
      {
        leadId: leadsByTitle["Williams Fireplace Surround"].id,
        userId: userMap["cruz.martinez@cadstone.internal"].id,
      },
      {
        leadId: leadsByTitle["Davis Full Home Renovation"].id,
        userId: userMap["maria.garcia@cadstone.internal"].id,
      },
      {
        leadId: leadsByTitle["Brown Office Reception"].id,
        userId: userMap["cruz.martinez@cadstone.internal"].id,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(leadTags)
    .values([
      { leadId: leadsByTitle["Williams Fireplace Surround"].id, tagName: "fireplace" },
      { leadId: leadsByTitle["Davis Full Home Renovation"].id, tagName: "full-home" },
      { leadId: leadsByTitle["Brown Office Reception"].id, tagName: "commercial" },
    ])
    .onConflictDoNothing();

  await db
    .insert(leadSources)
    .values([
      { leadId: leadsByTitle["Williams Fireplace Surround"].id, sourceName: "Referral" },
      { leadId: leadsByTitle["Davis Full Home Renovation"].id, sourceName: "Google Ads" },
      { leadId: leadsByTitle["Brown Office Reception"].id, sourceName: "Architect Referral" },
    ])
    .onConflictDoNothing();

  await db
    .insert(leadAttachments)
    .values([
      {
        leadId: leadsByTitle["Brown Office Reception"].id,
        fileId: johnsonProposalFile.id,
      },
    ])
    .onConflictDoNothing();

  await upsertScheduleItem({
    jobId: jobsByTitle["Smith Kitchen Remodel"].id,
    title: "Finalize kitchen templates",
    displayColor: "#2563eb",
    startDate: "2026-04-12",
    endDate: "2026-04-14",
    workDays: 3,
    progress: 35,
    createdBy: userMap["maria.garcia@cadstone.internal"].id,
    notes: "Confirm seam placement with homeowner before CNC cut.",
    assignees: [
      userMap["maria.garcia@cadstone.internal"].id,
      userMap["jake.thompson@cadstone.internal"].id,
    ],
  });
  await upsertScheduleItem({
    jobId: jobsByTitle["Johnson Master Bath"].id,
    title: "Install vanity tops",
    displayColor: "#22c55e",
    startDate: "2026-04-18",
    endDate: "2026-04-19",
    workDays: 2,
    progress: 10,
    createdBy: userMap["maria.garcia@cadstone.internal"].id,
    notes: "Coordinate with plumbing rough-in completion before arrival.",
    assignees: [userMap["jake.thompson@cadstone.internal"].id],
  });

  const smithDailyLog = await upsertDailyLog({
    jobId: jobsByTitle["Smith Kitchen Remodel"].id,
    logDate: "2026-04-05",
    title: "Cabinet prep and site walk",
    notes:
      "Completed field verification, confirmed cabinet level, and reviewed seam locations with the homeowner. No blocking issues for fabrication.",
    createdBy: userMap["maria.garcia@cadstone.internal"].id,
    publishedAt: new Date("2026-04-05T17:30:00Z"),
    weatherData: {
      condition: "Sunny",
      tempHighF: 72,
      tempLowF: 48,
      windMph: 11,
      humidity: 36,
      precipitationIn: 0,
    },
    tags: ["template", "site-walk"],
    attachmentFileIds: [smithMeasureFile.id, smithPhotoFile.id],
  });
  const johnsonDailyLog = await upsertDailyLog({
    jobId: jobsByTitle["Johnson Master Bath"].id,
    logDate: "2026-04-04",
    title: "Existing top removal complete",
    notes:
      "Crew removed the existing cultured marble top and protected adjacent finishes. Vanity base is ready for install after minor wall patch cure.",
    createdBy: userMap["jake.thompson@cadstone.internal"].id,
    publishedAt: new Date("2026-04-04T22:10:00Z"),
    weatherData: {
      condition: "Cloudy",
      tempHighF: 61,
      tempLowF: 43,
      windMph: 8,
      humidity: 41,
      precipitationIn: 0.02,
    },
    tags: ["demo", "prep"],
    attachmentFileIds: [johnsonPhotoFile.id],
  });

  const [hasActivity] = await db
    .select({ id: activityLog.id })
    .from(activityLog)
    .limit(1);

  if (!hasActivity) {
    await db.insert(activityLog).values([
      {
        entityType: "file",
        entityId: smithChangeOrderFile.id,
        action: "uploaded",
        userId: userMap["cruz.martinez@cadstone.internal"].id,
        metadata: {
          description: "Uploaded Smith Change Order 01.pdf",
          jobTitle: "Smith Kitchen Remodel",
        },
      },
      {
        entityType: "daily_log",
        entityId: johnsonDailyLog.id,
        action: "published",
        userId: userMap["jake.thompson@cadstone.internal"].id,
        metadata: {
          description: "Published daily log: Existing top removal complete",
          jobTitle: "Johnson Master Bath",
        },
      },
      {
        entityType: "daily_log",
        entityId: smithDailyLog.id,
        action: "created",
        userId: userMap["maria.garcia@cadstone.internal"].id,
        metadata: {
          description: "Created daily log: Cabinet prep and site walk",
          jobTitle: "Smith Kitchen Remodel",
        },
      },
      {
        entityType: "lead",
        entityId: leadsByTitle["Davis Full Home Renovation"].id,
        action: "updated",
        userId: userMap["maria.garcia@cadstone.internal"].id,
        metadata: {
          description: "Updated projected sales date and revenue range",
        },
      },
    ]);
  }

  return {
    password: DEFAULT_SEED_PASSWORD,
    users: userEntries,
    jobs: jobEntries,
    leads: leadEntries,
  };
}
