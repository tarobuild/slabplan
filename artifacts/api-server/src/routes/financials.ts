import { promises as fsp } from "node:fs";
import { z } from "zod";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  changeOrders,
  files,
  financialTrackers,
  folders,
  invoiceLinePayments,
  jobs,
  sovAreas,
  sovLineItems,
  trackerInvoices,
} from "@workspace/db/schema";
import { anthropic, type ContentBlockParam } from "@workspace/integrations-anthropic-ai";
import {
  assertCanAccessJob,
  assertCanManageJob,
} from "../lib/authorization";
import { HttpError, asyncHandler } from "../lib/http";
import { uploadSingle } from "../lib/uploads";
import { createAiParsePerUserRateLimit } from "../lib/rate-limit";

// Per-user rate limiter for AI-backed parses. Mounted on the two
// endpoints that actually call Anthropic (estimate + invoice). Keep the
// reference module-scoped so all calls share one bucket map.
const aiParseRateLimit = createAiParsePerUserRateLimit();
import { openStoredFileReadStream } from "../lib/storage";
import {
  ensureSystemFolders,
  saveUploadedFiles,
  validateUploadForMediaType,
  writeActivity,
} from "../lib/file-manager";
import { requireManagerOrAbove } from "../middleware/require-auth";
import { logger } from "../lib/logger";

const router: IRouter = Router({ mergeParams: true });

type AnthropicCreateArgs = Parameters<typeof anthropic.messages.create>[0];
// The route never enables streaming, so the response is always a
// non-stream Message — narrow the union here so callers can read
// `.content` without re-casting at every site.
type AnthropicMessageResponse = Extract<
  Awaited<ReturnType<typeof anthropic.messages.create>>,
  { content: unknown }
>;

/**
 * Wrap every Anthropic call from this route file with structured
 * observability so we can answer "what's AI costing per feature?" and
 * "which prompt class is failing right now?" from logs alone.
 *
 * On success: logs `{ event, jobId, model, promptTokens, completionTokens,
 * totalTokens, durationMs }`.
 * On failure: logs `errorCode: "AI_PARSE_FAILED"` plus a sanitized,
 * length-capped excerpt of the error message — never the prompt body
 * or PII.
 */
async function callAnthropicWithLogging(args: {
  event: "ai.estimate.parse" | "ai.invoice.parse";
  jobId: string;
  request: AnthropicCreateArgs;
}): Promise<AnthropicMessageResponse> {
  const startedAt = Date.now();
  try {
    const response = (await anthropic.messages.create(
      args.request,
    )) as AnthropicMessageResponse;
    const usage = (response as { usage?: { input_tokens?: number; output_tokens?: number } })
      .usage ?? {};
    const promptTokens = Number(usage.input_tokens ?? 0);
    const completionTokens = Number(usage.output_tokens ?? 0);
    logger.info(
      {
        event: args.event,
        jobId: args.jobId,
        model: (args.request as { model?: string }).model ?? null,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        durationMs: Date.now() - startedAt,
      },
      "anthropic call",
    );
    return response;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Strip newlines + cap length so we never blow up a log line and
    // never accidentally surface a multi-line stack with PII.
    const excerpt = raw.replace(/\s+/g, " ").trim().slice(0, 200);
    logger.warn(
      {
        event: args.event,
        jobId: args.jobId,
        model: (args.request as { model?: string }).model ?? null,
        durationMs: Date.now() - startedAt,
        errorCode: "AI_PARSE_FAILED",
        errorExcerpt: excerpt,
      },
      "anthropic call failed",
    );
    throw err;
  }
}

// Whole financials surface is admin/PM only — crew_member cannot read it.
router.use(requireManagerOrAbove);

const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_MAX_TOKENS = 8192;

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new HttpError(400, `Missing ${label}.`);
  return normalized;
}

/**
 * Ownership guards: every sub-resource (area, line item, change order,
 * invoice) must belong to the tracker for the jobId in the URL path.
 * These helpers query the row joined to financial_trackers and throw
 * 404 when it doesn't belong to the requested job. They prevent IDOR
 * across jobs.
 */
async function assertAreaInJob(areaId: string, jobId: string) {
  const [row] = await db
    .select({ id: sovAreas.id, jobId: financialTrackers.jobId })
    .from(sovAreas)
    .innerJoin(financialTrackers, eq(sovAreas.trackerId, financialTrackers.id))
    .where(eq(sovAreas.id, areaId))
    .limit(1);
  if (!row || row.jobId !== jobId) throw new HttpError(404, "Area not found.");
}

async function assertLineItemInJob(lineItemId: string, jobId: string) {
  const [row] = await db
    .select({ id: sovLineItems.id, jobId: financialTrackers.jobId })
    .from(sovLineItems)
    .innerJoin(sovAreas, eq(sovLineItems.areaId, sovAreas.id))
    .innerJoin(financialTrackers, eq(sovAreas.trackerId, financialTrackers.id))
    .where(eq(sovLineItems.id, lineItemId))
    .limit(1);
  if (!row || row.jobId !== jobId) throw new HttpError(404, "Line item not found.");
}

async function assertChangeOrderInJob(coId: string, jobId: string) {
  const [row] = await db
    .select({ id: changeOrders.id, jobId: financialTrackers.jobId })
    .from(changeOrders)
    .innerJoin(financialTrackers, eq(changeOrders.trackerId, financialTrackers.id))
    .where(eq(changeOrders.id, coId))
    .limit(1);
  if (!row || row.jobId !== jobId) throw new HttpError(404, "Change order not found.");
}

async function assertInvoiceInJob(invoiceId: string, jobId: string) {
  const [row] = await db
    .select({ id: trackerInvoices.id, jobId: financialTrackers.jobId })
    .from(trackerInvoices)
    .innerJoin(financialTrackers, eq(trackerInvoices.trackerId, financialTrackers.id))
    .where(eq(trackerInvoices.id, invoiceId))
    .limit(1);
  if (!row || row.jobId !== jobId) throw new HttpError(404, "Invoice not found.");
}

async function getOrCreateTracker(jobId: string, userId: string) {
  const existing = await db
    .select()
    .from(financialTrackers)
    .where(eq(financialTrackers.jobId, jobId))
    .limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(financialTrackers)
    .values({ jobId, createdBy: userId })
    .returning();
  return created;
}

async function loadTrackerWithChildren(trackerId: string) {
  const [tracker] = await db
    .select()
    .from(financialTrackers)
    .where(eq(financialTrackers.id, trackerId))
    .limit(1);
  if (!tracker) throw new HttpError(404, "Tracker not found.");

  // The frontend needs the parent clientId on every financials
  // response so cache invalidation can refresh the Client Detail AR
  // card by its literal queryKey (#275 follow-up). One small lookup
  // here keeps all 5 mutation routes from having to do it.
  const [jobRow] = await db
    .select({ clientId: jobs.clientId })
    .from(jobs)
    .where(eq(jobs.id, tracker.jobId))
    .limit(1);
  const clientId = jobRow?.clientId ?? null;

  const [areas, lineItems, cos, invoices, payments] = await Promise.all([
    db
      .select()
      .from(sovAreas)
      .where(eq(sovAreas.trackerId, trackerId))
      .orderBy(asc(sovAreas.sortOrder), asc(sovAreas.name)),
    db
      .select({
        id: sovLineItems.id,
        areaId: sovLineItems.areaId,
        description: sovLineItems.description,
        qty: sovLineItems.qty,
        rateCents: sovLineItems.rateCents,
        scheduledValueCents: sovLineItems.scheduledValueCents,
        billedCents: sovLineItems.billedCents,
        percentComplete: sovLineItems.percentComplete,
        isRemoved: sovLineItems.isRemoved,
        isChangeOrder: sovLineItems.isChangeOrder,
        sortOrder: sovLineItems.sortOrder,
      })
      .from(sovLineItems)
      .innerJoin(sovAreas, eq(sovLineItems.areaId, sovAreas.id))
      .where(eq(sovAreas.trackerId, trackerId))
      .orderBy(asc(sovLineItems.sortOrder), asc(sovLineItems.description)),
    db
      .select()
      .from(changeOrders)
      .where(eq(changeOrders.trackerId, trackerId))
      .orderBy(asc(changeOrders.number)),
    db
      .select()
      .from(trackerInvoices)
      .where(eq(trackerInvoices.trackerId, trackerId))
      .orderBy(desc(trackerInvoices.invoiceDate), desc(trackerInvoices.createdAt)),
    db
      .select({
        id: invoiceLinePayments.id,
        invoiceId: invoiceLinePayments.invoiceId,
        lineItemId: invoiceLinePayments.lineItemId,
        amountCents: invoiceLinePayments.amountCents,
      })
      .from(invoiceLinePayments)
      .innerJoin(trackerInvoices, eq(invoiceLinePayments.invoiceId, trackerInvoices.id))
      .where(eq(trackerInvoices.trackerId, trackerId)),
  ]);

  const paymentsByInvoice: Record<
    string,
    Array<{ id: string; lineItemId: string; amountCents: number }>
  > = {};
  const paymentsByLineItem: Record<
    string,
    Array<{ id: string; invoiceId: string; amountCents: number }>
  > = {};
  for (const p of payments) {
    (paymentsByInvoice[p.invoiceId] ??= []).push({
      id: p.id,
      lineItemId: p.lineItemId,
      amountCents: Number(p.amountCents ?? 0),
    });
    (paymentsByLineItem[p.lineItemId] ??= []).push({
      id: p.id,
      invoiceId: p.invoiceId,
      amountCents: Number(p.amountCents ?? 0),
    });
  }

  const itemsByArea: Record<string, typeof lineItems> = {};
  for (const li of lineItems) {
    const aid = li.areaId ?? "";
    (itemsByArea[aid] ??= []).push(li);
  }

  let scheduledTotal = 0;
  let billedTotal = 0;
  for (const li of lineItems) {
    if (li.isRemoved) continue;
    scheduledTotal += Number(li.scheduledValueCents ?? 0);
    billedTotal += Number(li.billedCents ?? 0);
  }
  const changeOrderTotal = cos
    .filter((c) => c.status === "approved")
    .reduce((s, c) => s + Number(c.amountCents ?? 0), 0);

  const totals = {
    scheduledValueCents: scheduledTotal,
    billedCents: billedTotal,
    outstandingCents: Math.max(0, scheduledTotal + changeOrderTotal - billedTotal),
    changeOrderApprovedCents: changeOrderTotal,
    contractWithChangesCents: scheduledTotal + changeOrderTotal,
    percentBilled:
      scheduledTotal + changeOrderTotal > 0
        ? Math.min(
            100,
            Math.round(
              (billedTotal / (scheduledTotal + changeOrderTotal)) * 10000,
            ) / 100,
          )
        : 0,
  };

  return {
    tracker,
    clientId,
    areas: areas.map((a) => ({
      ...a,
      lineItems: (itemsByArea[a.id] ?? []).map((li) => ({
        ...li,
        payments: paymentsByLineItem[li.id] ?? [],
      })),
    })),
    changeOrders: cos,
    invoices: invoices.map((inv) => ({
      ...inv,
      payments: paymentsByInvoice[inv.id] ?? [],
    })),
    totals,
  };
}

router.get(
  "/:jobId/financials",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanAccessJob(req.auth!, jobId);
    const tracker = await getOrCreateTracker(jobId, req.auth!.userId);
    const data = await loadTrackerWithChildren(tracker.id);
    res.json(data);
  }),
);

const trackerPatchSchema = z.object({
  projectName: z.string().trim().max(255).nullable().optional(),
  contractDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  currency: z.string().trim().min(1).max(8).optional(),
});

router.patch(
  "/:jobId/financials",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const tracker = await getOrCreateTracker(jobId, req.auth!.userId);
    const body = trackerPatchSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid payload.", body.error.flatten());
    const [updated] = await db
      .update(financialTrackers)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(financialTrackers.id, tracker.id))
      .returning();
    res.json({ tracker: updated });
  }),
);

// ---------------------------------------------------------------------------
// AI: parse estimate PDF
// ---------------------------------------------------------------------------

async function readFileBytes(fileUrl: string): Promise<Buffer> {
  const stream = openStoredFileReadStream(fileUrl);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const ESTIMATE_SYSTEM_PROMPT = `You are an estimating assistant for a stone-fabrication contractor.
Parse the attached estimate PDF and return ONLY valid JSON, no prose, in this exact shape:
{
  "projectName": string | null,
  "contractDate": string | null,            // YYYY-MM-DD
  "areas": [
    {
      "name": string,                        // e.g. "Kitchen", "Master Bathroom"
      "floor": string | null,                // e.g. "Floor 1"
      "lineItems": [
        {
          "description": string,
          "qty": number,
          "rateCents": number,               // unit price in cents
          "scheduledValueCents": number      // total value in cents (qty * rate)
        }
      ]
    }
  ]
}
Use cents (integers). Do not invent numbers. If a value is unknown, use 0 or null appropriately.`;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < 0) {
    throw new HttpError(502, "AI did not return JSON.");
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    throw new HttpError(502, "AI returned invalid JSON.", { error: String(err) });
  }
}

const estimateAiSchema = z.object({
  projectName: z.string().nullable().optional(),
  contractDate: z.string().nullable().optional(),
  areas: z
    .array(
      z.object({
        name: z.string().min(1),
        floor: z.string().nullable().optional(),
        lineItems: z
          .array(
            z.object({
              description: z.string().min(1),
              qty: z.coerce.number().default(1),
              rateCents: z.coerce.number().int().nonnegative().default(0),
              scheduledValueCents: z.coerce.number().int().nonnegative().default(0),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

async function findFinancialsFolderId(jobId: string): Promise<string | null> {
  // Make sure the per-job system folders (incl. "11. FINANCIALS") exist
  // before looking it up. ensureSystemFolders is idempotent.
  await ensureSystemFolders(jobId, { includeJobTemplates: true });
  const [folder] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.jobId, jobId),
        eq(folders.scope, "job"),
        eq(folders.title, "11. FINANCIALS"),
        isNull(folders.deletedAt),
        isNull(folders.parentFolderId),
      ),
    )
    .limit(1);
  return folder?.id ?? null;
}

const ESTIMATE_IMAGE_ANTHROPIC_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

type AnthropicImageMedia = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

async function buildAnthropicContent(
  upload: Express.Multer.File,
  bytes: Buffer,
): Promise<ContentBlockParam[]> {
  const mt = (upload.mimetype ?? "").toLowerCase();
  const ext = (upload.originalname ?? "").toLowerCase().split(".").pop() ?? "";

  if (mt === "application/pdf" || ext === "pdf") {
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: bytes.toString("base64"),
        },
      },
    ];
  }
  if (mt.startsWith("image/")) {
    const media: AnthropicImageMedia = (
      ESTIMATE_IMAGE_ANTHROPIC_MEDIA.has(mt) ? mt : "image/jpeg"
    ) as AnthropicImageMedia;
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: media,
          data: bytes.toString("base64"),
        },
      },
    ];
  }
  // DOCX → mammoth → text
  if (
    mt === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: bytes });
    const text = (result.value ?? "").slice(0, 200_000);
    return [
      {
        type: "text",
        text: `Estimate file (${upload.originalname ?? "document.docx"}) extracted text:\n\n${text}`,
      },
    ];
  }
  // Legacy .xls (binary BIFF) — exceljs only reads .xlsx, so surface a
  // clear "save as .xlsx" message instead of pretending to support it.
  if (mt === "application/vnd.ms-excel" || ext === "xls") {
    throw new HttpError(
      400,
      "Legacy .xls files (Excel 97–2003) are not supported. " +
        "Please open the file in Excel or Numbers and save it as .xlsx, then re-upload.",
    );
  }
  // XLSX → exceljs → CSV per sheet → text
  if (
    mt === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === "xlsx"
  ) {
    const { parseXlsxToSheets } = await import("../lib/spreadsheet");
    const parsed = await parseXlsxToSheets(bytes);
    const parts = parsed.sheets.map(
      (s) => `### Sheet: ${s.name}\n${s.csv}`,
    );
    const text = parts.join("\n\n").slice(0, 200_000);
    return [
      {
        type: "text",
        text: `Estimate spreadsheet (${upload.originalname ?? "document.xlsx"}) as CSV:\n\n${text}`,
      },
    ];
  }
  // Plain text / CSV / TSV / JSON / Markdown
  if (mt.startsWith("text/") || mt === "application/json") {
    const text = bytes.toString("utf8").slice(0, 200_000);
    return [
      {
        type: "text",
        text: `Estimate file (${upload.originalname ?? "file"}):\n\n${text}`,
      },
    ];
  }
  throw new HttpError(
    400,
    "AI parse supports PDF, images (JPEG/PNG/GIF/WebP), DOCX, XLSX, or " +
      "text/CSV files.",
  );
}

router.post(
  "/:jobId/financials/estimate",
  aiParseRateLimit,
  uploadSingle("file"),
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);

    const upload = (req.file ?? null) as Express.Multer.File | null;
    if (!upload) throw new HttpError(400, "Missing estimate file.");
    // Accept the broader document/photo set via shared validators (PDF,
    // DOCX, XLSX, CSV, TXT, JPG/PNG/etc.).
    const isImage = (upload.mimetype ?? "").toLowerCase().startsWith("image/");
    try {
      validateUploadForMediaType(isImage ? "photo" : "document", upload);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "Unsupported estimate file type.");
    }
    const tracker = await getOrCreateTracker(jobId, req.auth!.userId);

    // Read the bytes BEFORE saveUploadedFiles (which consumes the multer
    // temp file).
    let bytes: Buffer;
    if (upload.buffer && upload.buffer.length > 0) {
      bytes = upload.buffer;
    } else if (upload.path) {
      bytes = await fsp.readFile(upload.path);
    } else {
      throw new HttpError(500, "Could not read uploaded estimate.");
    }

    // Persist file to the per-job FINANCIALS system folder.
    let estimateFileId: string | null = null;
    const financialsFolderId = await findFinancialsFolderId(jobId);
    if (financialsFolderId) {
      const saved = await saveUploadedFiles({
        folderId: financialsFolderId,
        userId: req.auth!.userId,
        uploadedFiles: [upload],
        note: "AI-parsed estimate",
      });
      estimateFileId = saved.files[0]?.id ?? null;
    }

    const userContent: ContentBlockParam[] = await buildAnthropicContent(
      upload,
      bytes,
    );
    userContent.push({
      type: "text",
      text: "Parse this estimate and return the JSON described above.",
    });

    const aiResp = await callAnthropicWithLogging({
      event: "ai.estimate.parse",
      jobId,
      request: {
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: ESTIMATE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      },
    });

    const textBlock = aiResp.content.find(
      (b: { type: string }) => b.type === "text",
    ) as { type: "text"; text: string } | undefined;
    if (!textBlock) {
      throw new HttpError(502, "AI returned no text.");
    }
    const parsed = extractJson(textBlock.text);
    const validated = estimateAiSchema.safeParse(parsed);
    if (!validated.success) {
      throw new HttpError(502, "AI response did not match expected shape.", {
        issues: validated.error.flatten(),
      });
    }

    // REPLACE the existing SOV (non-CO) with the AI parse, preserving
    // invoice attachments by re-matching invoice_line_payments to new
    // line items by (area name, description). Change-order areas/items
    // are never touched. Unmatched payments are dropped from the new
    // SOV; the original invoice records (and their raw AI matches) are
    // kept so the user can re-apply them via the matches editor.
    await db.transaction(async (tx) => {
      // 1) Snapshot existing non-CO line items + their payments so we
      //    can map (area name, description) → payments.
      const existingItems = await tx
        .select({
          id: sovLineItems.id,
          description: sovLineItems.description,
          areaName: sovAreas.name,
        })
        .from(sovLineItems)
        .innerJoin(sovAreas, eq(sovLineItems.areaId, sovAreas.id))
        .where(
          and(
            eq(sovAreas.trackerId, tracker.id),
            eq(sovAreas.isChangeOrderGroup, false),
          ),
        );
      const existingItemIds = existingItems.map((i) => i.id);
      const existingPayments = existingItemIds.length
        ? await tx
            .select({
              invoiceId: invoiceLinePayments.invoiceId,
              lineItemId: invoiceLinePayments.lineItemId,
              amountCents: invoiceLinePayments.amountCents,
            })
            .from(invoiceLinePayments)
            .where(inArray(invoiceLinePayments.lineItemId, existingItemIds))
        : [];
      const itemById = new Map(
        existingItems.map((i) => [i.id, i] as const),
      );
      const matchKey = (area: string, desc: string) =>
        `${area.trim().toLowerCase()}|${desc.trim().toLowerCase()}`;

      // 2) Delete non-CO areas (cascades line items + their payments).
      await tx
        .delete(sovAreas)
        .where(
          and(
            eq(sovAreas.trackerId, tracker.id),
            eq(sovAreas.isChangeOrderGroup, false),
          ),
        );

      // 3) Insert the new areas/line items, building a key → newId map
      //    so we can reattach payments below.
      const newItemByKey = new Map<string, string>();
      let areaSort = 0;
      for (const area of validated.data.areas) {
        const [createdArea] = await tx
          .insert(sovAreas)
          .values({
            trackerId: tracker.id,
            name: area.name,
            floor: area.floor ?? null,
            sortOrder: areaSort++,
            isChangeOrderGroup: false,
          })
          .returning();
        if (area.lineItems.length > 0) {
          let liSort = 0;
          const created = await tx
            .insert(sovLineItems)
            .values(
              area.lineItems.map((li) => ({
                areaId: createdArea.id,
                description: li.description,
                qty: String(li.qty ?? 1),
                rateCents: li.rateCents ?? 0,
                scheduledValueCents:
                  li.scheduledValueCents || (li.qty ?? 1) * (li.rateCents ?? 0),
                sortOrder: liSort++,
              })),
            )
            .returning({ id: sovLineItems.id, description: sovLineItems.description });
          for (const c of created) {
            newItemByKey.set(matchKey(area.name, c.description), c.id);
          }
        }
      }

      // 4) Reattach payments by description match. Group payments per
      //    invoice + new line item and increment billedCents accordingly.
      const reattach = new Map<string, { invoiceId: string; lineItemId: string; amountCents: number }>();
      for (const p of existingPayments) {
        const old = itemById.get(p.lineItemId);
        if (!old) continue;
        const newId = newItemByKey.get(matchKey(old.areaName, old.description));
        if (!newId) continue;
        const k = `${p.invoiceId}|${newId}`;
        const prev = reattach.get(k);
        const amt = Number(p.amountCents ?? 0);
        if (prev) prev.amountCents += amt;
        else reattach.set(k, { invoiceId: p.invoiceId, lineItemId: newId, amountCents: amt });
      }
      if (reattach.size > 0) {
        // Cap each reattached amount to the new line item's remaining
        // capacity (scheduled - already-applied) so the stored payment
        // exactly equals the credit to billed_cents. Symmetric reversal
        // on later invoice delete then leaves no drift.
        const reAttachLineIds = Array.from(
          new Set(Array.from(reattach.values()).map((r) => r.lineItemId)),
        );
        const newLineRows = await tx
          .select({
            id: sovLineItems.id,
            scheduledValueCents: sovLineItems.scheduledValueCents,
            billedCents: sovLineItems.billedCents,
          })
          .from(sovLineItems)
          .where(inArray(sovLineItems.id, reAttachLineIds));
        const remaining = new Map<string, number>();
        for (const li of newLineRows) {
          remaining.set(
            li.id,
            Math.max(
              0,
              Number(li.scheduledValueCents ?? 0) - Number(li.billedCents ?? 0),
            ),
          );
        }
        const cappedReattach: Array<{ invoiceId: string; lineItemId: string; amountCents: number }> = [];
        for (const r of reattach.values()) {
          const cap = remaining.get(r.lineItemId) ?? 0;
          const applied = Math.max(0, Math.min(r.amountCents, cap));
          if (applied > 0) {
            cappedReattach.push({
              invoiceId: r.invoiceId,
              lineItemId: r.lineItemId,
              amountCents: applied,
            });
            remaining.set(r.lineItemId, cap - applied);
          }
        }
        if (cappedReattach.length > 0) {
          await tx.insert(invoiceLinePayments).values(cappedReattach);
          for (const r of cappedReattach) {
            await tx
              .update(sovLineItems)
              .set({
                billedCents: sql`${sovLineItems.billedCents} + ${r.amountCents}`,
                updatedAt: new Date(),
              })
              .where(eq(sovLineItems.id, r.lineItemId));
          }
        }
        // Recompute percent_complete from billed/scheduled for every line
        // item we just reattached so the UI's % bars and status pills
        // stay consistent with the restored billed amounts.
        const reattachedIds = Array.from(
          new Set(Array.from(reattach.values()).map((r) => r.lineItemId)),
        );
        await tx
          .update(sovLineItems)
          .set({
            percentComplete: sql`case when ${sovLineItems.scheduledValueCents} > 0
              then round((${sovLineItems.billedCents}::numeric / ${sovLineItems.scheduledValueCents}::numeric) * 100, 2)
              else 0 end`,
            updatedAt: new Date(),
          })
          .where(inArray(sovLineItems.id, reattachedIds));
      }

      await tx
        .update(financialTrackers)
        .set({
          projectName: validated.data.projectName ?? tracker.projectName,
          contractDate: validated.data.contractDate ?? tracker.contractDate,
          rawEstimateResponse: parsed as Record<string, unknown>,
          estimateFileId: estimateFileId ?? tracker.estimateFileId,
          updatedAt: new Date(),
        })
        .where(eq(financialTrackers.id, tracker.id));
    });

    await writeActivity({
      entityType: "job",
      entityId: jobId,
      action: "financials.estimate_parsed",
      userId: req.auth!.userId,
      jobId,
      description: "Parsed estimate with AI",
    });

    const data = await loadTrackerWithChildren(tracker.id);
    res.status(201).json(data);
  }),
);

// ---------------------------------------------------------------------------
// SOV CRUD: areas, line items, change orders
// ---------------------------------------------------------------------------

const areaCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  floor: z.string().trim().max(100).nullable().optional(),
  isChangeOrderGroup: z.boolean().optional().default(false),
  sortOrder: z.coerce.number().int().optional().default(0),
});

router.post(
  "/:jobId/financials/areas",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const tracker = await getOrCreateTracker(jobId, req.auth!.userId);
    const body = areaCreateSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid area payload.", body.error.flatten());
    const [area] = await db
      .insert(sovAreas)
      .values({
        trackerId: tracker.id,
        name: body.data.name,
        floor: body.data.floor ?? null,
        isChangeOrderGroup: body.data.isChangeOrderGroup,
        sortOrder: body.data.sortOrder,
      })
      .returning();
    res.status(201).json({ area });
  }),
);

router.patch(
  "/:jobId/financials/areas/:areaId",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const areaId = getParam(req.params.areaId, "area id");
    await assertAreaInJob(areaId, jobId);
    const body = areaCreateSchema.partial().safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid area payload.", body.error.flatten());
    const [area] = await db
      .update(sovAreas)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(sovAreas.id, areaId))
      .returning();
    if (!area) throw new HttpError(404, "Area not found.");
    res.json({ area });
  }),
);

router.delete(
  "/:jobId/financials/areas/:areaId",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const areaId = getParam(req.params.areaId, "area id");
    await assertAreaInJob(areaId, jobId);
    await db.delete(sovAreas).where(eq(sovAreas.id, areaId));
    res.json({ success: true });
  }),
);

const lineItemCreateSchema = z.object({
  areaId: z.string().uuid(),
  description: z.string().trim().min(1),
  qty: z.coerce.number().optional().default(1),
  rateCents: z.coerce.number().int().nonnegative().optional().default(0),
  scheduledValueCents: z.coerce.number().int().nonnegative().optional().default(0),
  isChangeOrder: z.boolean().optional().default(false),
  sortOrder: z.coerce.number().int().optional().default(0),
});

router.post(
  "/:jobId/financials/line-items",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const body = lineItemCreateSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid line item.", body.error.flatten());
    await assertAreaInJob(body.data.areaId, jobId);
    const scheduled =
      body.data.scheduledValueCents ||
      Math.round((body.data.qty ?? 1) * (body.data.rateCents ?? 0));
    const [item] = await db
      .insert(sovLineItems)
      .values({
        areaId: body.data.areaId,
        description: body.data.description,
        qty: String(body.data.qty ?? 1),
        rateCents: body.data.rateCents ?? 0,
        scheduledValueCents: scheduled,
        isChangeOrder: body.data.isChangeOrder ?? false,
        sortOrder: body.data.sortOrder ?? 0,
      })
      .returning();
    res.status(201).json({ lineItem: item });
  }),
);

const lineItemPatchSchema = z.object({
  description: z.string().trim().min(1).optional(),
  qty: z.coerce.number().optional(),
  rateCents: z.coerce.number().int().nonnegative().optional(),
  scheduledValueCents: z.coerce.number().int().nonnegative().optional(),
  percentComplete: z.coerce.number().min(0).max(100).optional(),
  isRemoved: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

router.patch(
  "/:jobId/financials/line-items/:lineItemId",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const lineItemId = getParam(req.params.lineItemId, "line item id");
    await assertLineItemInJob(lineItemId, jobId);
    const body = lineItemPatchSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid line item.", body.error.flatten());

    const [current] = await db
      .select()
      .from(sovLineItems)
      .where(eq(sovLineItems.id, lineItemId))
      .limit(1);
    if (!current) throw new HttpError(404, "Line item not found.");

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.description !== undefined) updates.description = body.data.description;
    if (body.data.qty !== undefined) updates.qty = String(body.data.qty);
    if (body.data.rateCents !== undefined) updates.rateCents = body.data.rateCents;
    if (body.data.isRemoved !== undefined) updates.isRemoved = body.data.isRemoved;
    if (body.data.sortOrder !== undefined) updates.sortOrder = body.data.sortOrder;

    // Compute next scheduled and percent so we can derive billed = scheduled * pct.
    const nextScheduled =
      body.data.scheduledValueCents !== undefined
        ? body.data.scheduledValueCents
        : Number(current.scheduledValueCents ?? 0);
    let nextPct =
      body.data.percentComplete !== undefined
        ? body.data.percentComplete
        : Number(current.percentComplete ?? 0);

    const scheduledChanged = body.data.scheduledValueCents !== undefined;
    const pctChanged = body.data.percentComplete !== undefined;

    if (scheduledChanged) updates.scheduledValueCents = nextScheduled;

    if (pctChanged) {
      // Explicit pct edit: derive billed from scheduled * pct, capped.
      let nextBilled = Math.round((nextScheduled * nextPct) / 100);
      if (nextBilled > nextScheduled) nextBilled = nextScheduled;
      nextPct = nextScheduled > 0 ? (nextBilled / nextScheduled) * 100 : 0;
      updates.billedCents = nextBilled;
      updates.percentComplete = nextPct.toFixed(2);
    } else if (scheduledChanged) {
      // Scheduled-only edit: preserve invoice-applied billed amounts.
      // Only cap billed down to the new scheduled if it would otherwise
      // exceed 100%. Then recompute pct from billed/scheduled. Never
      // inflate billed when scheduled grows.
      const currentBilled = Number(current.billedCents ?? 0);
      const nextBilled = Math.min(currentBilled, nextScheduled);
      const recomputedPct =
        nextScheduled > 0 ? (nextBilled / nextScheduled) * 100 : 0;
      updates.billedCents = nextBilled;
      updates.percentComplete = recomputedPct.toFixed(2);
    }

    const [item] = await db
      .update(sovLineItems)
      .set(updates)
      .where(eq(sovLineItems.id, lineItemId))
      .returning();
    res.json({ lineItem: item });
  }),
);

router.delete(
  "/:jobId/financials/line-items/:lineItemId",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const lineItemId = getParam(req.params.lineItemId, "line item id");
    await assertLineItemInJob(lineItemId, jobId);
    await db.delete(sovLineItems).where(eq(sovLineItems.id, lineItemId));
    res.json({ success: true });
  }),
);

const changeOrderSchema = z.object({
  number: z.string().trim().min(1).max(64),
  description: z.string().trim().nullable().optional(),
  amountCents: z.coerce.number().int().default(0),
  status: z.enum(["pending", "approved", "rejected"]).optional().default("pending"),
  areaId: z.string().uuid().nullable().optional(),
});

router.post(
  "/:jobId/financials/change-orders",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const tracker = await getOrCreateTracker(jobId, req.auth!.userId);
    const body = changeOrderSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid change order.", body.error.flatten());
    if (body.data.areaId) await assertAreaInJob(body.data.areaId, jobId);
    const [co] = await db
      .insert(changeOrders)
      .values({
        trackerId: tracker.id,
        number: body.data.number,
        description: body.data.description ?? null,
        amountCents: body.data.amountCents,
        status: body.data.status,
        areaId: body.data.areaId ?? null,
      })
      .returning();
    res.status(201).json({ changeOrder: co });
  }),
);

router.patch(
  "/:jobId/financials/change-orders/:coId",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const coId = getParam(req.params.coId, "change order id");
    await assertChangeOrderInJob(coId, jobId);
    const body = changeOrderSchema.partial().safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid change order.", body.error.flatten());
    if (body.data.areaId) await assertAreaInJob(body.data.areaId, jobId);
    const [co] = await db
      .update(changeOrders)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(changeOrders.id, coId))
      .returning();
    if (!co) throw new HttpError(404, "Change order not found.");
    res.json({ changeOrder: co });
  }),
);

router.delete(
  "/:jobId/financials/change-orders/:coId",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const coId = getParam(req.params.coId, "change order id");
    await assertChangeOrderInJob(coId, jobId);
    await db.delete(changeOrders).where(eq(changeOrders.id, coId));
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// AI: ingest invoice and apply payments to line items
// ---------------------------------------------------------------------------

const INVOICE_SYSTEM_PROMPT = `You receive an invoice PDF and the current Schedule of Values for a stone-fabrication job.
Match each invoice line to the most likely SOV line item and return ONLY valid JSON in this shape:
{
  "invoiceNumber": string | null,
  "invoiceDate": string | null,             // YYYY-MM-DD
  "totalCents": number,
  "matches": [
    {
      "sovLineItemId": string,              // must be one of the provided ids
      "amountCents": number                  // amount applied to this line, in cents
    }
  ]
}
Only use sovLineItemIds from the provided list. If you cannot confidently match a line, omit it.`;

const invoiceAiSchema = z.object({
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  totalCents: z.coerce.number().int().default(0),
  matches: z
    .array(
      z.object({
        sovLineItemId: z.string().uuid(),
        amountCents: z.coerce.number().int().nonnegative(),
      }),
    )
    .default([]),
});

async function applyInvoiceMatches(
  invoiceId: string,
  matches: Array<{ sovLineItemId: string; amountCents: number }>,
) {
  const startedAt = Date.now();
  await db.transaction(async (tx) => {
    // Reverse any existing payments for this invoice first. Net the
    // reversals per line item so a single batched UPDATE replaces what
    // used to be N sequential per-row UPDATEs holding row locks for the
    // duration of the transaction (Task #277).
    const existing = await tx
      .select()
      .from(invoiceLinePayments)
      .where(eq(invoiceLinePayments.invoiceId, invoiceId));

    // Pre-load current scheduled/billed for every line item we may
    // touch (existing reversals + new matches) in one round-trip.
    const touchedIds = Array.from(
      new Set<string>([
        ...existing.map((p) => p.lineItemId),
        ...matches.map((m) => m.sovLineItemId),
      ]),
    );
    type ItemSnapshot = {
      id: string;
      scheduled: number;
      billed: number;
    };
    const snapshot = new Map<string, ItemSnapshot>();
    if (touchedIds.length > 0) {
      const items = await tx
        .select({
          id: sovLineItems.id,
          scheduledValueCents: sovLineItems.scheduledValueCents,
          billedCents: sovLineItems.billedCents,
        })
        .from(sovLineItems)
        .where(inArray(sovLineItems.id, touchedIds));
      for (const li of items) {
        snapshot.set(li.id, {
          id: li.id,
          scheduled: Number(li.scheduledValueCents ?? 0),
          billed: Number(li.billedCents ?? 0),
        });
      }
    }

    // 1) Reverse existing payments in-memory.
    for (const p of existing) {
      const s = snapshot.get(p.lineItemId);
      if (!s) continue;
      s.billed = Math.max(0, s.billed - Number(p.amountCents ?? 0));
    }
    if (existing.length > 0) {
      await tx
        .delete(invoiceLinePayments)
        .where(eq(invoiceLinePayments.invoiceId, invoiceId));
    }

    // 2) Cap and apply each new match in-memory against the post-reversal
    // billed totals so the invariant `applied <= scheduled - billed`
    // still holds (and a future reversal subtracts exactly what was
    // applied).
    const cappedMatches: Array<{ sovLineItemId: string; amountCents: number }> = [];
    for (const m of matches) {
      const s = snapshot.get(m.sovLineItemId);
      if (!s) continue;
      const cap = Math.max(0, s.scheduled - s.billed);
      const applied = Math.max(0, Math.min(Number(m.amountCents), cap));
      if (applied > 0) {
        cappedMatches.push({ sovLineItemId: m.sovLineItemId, amountCents: applied });
        s.billed += applied;
      }
    }
    if (cappedMatches.length > 0) {
      await tx.insert(invoiceLinePayments).values(
        cappedMatches.map((m) => ({
          invoiceId,
          lineItemId: m.sovLineItemId,
          amountCents: m.amountCents,
        })),
      );
    }

    // 3) Single batched UPDATE per area/invoice instead of N sequential
    // UPDATEs. Using `update … from (values …) v(id, billed, pct)`
    // collapses every billed/percent_complete change into one
    // round-trip and one short-lived row lock per touched line item.
    if (touchedIds.length > 0) {
      const rows: Array<{ id: string; billed: number; pct: string }> = [];
      for (const s of snapshot.values()) {
        const pct = s.scheduled > 0
          ? Math.min(100, (s.billed / s.scheduled) * 100)
          : 0;
        rows.push({ id: s.id, billed: s.billed, pct: pct.toFixed(2) });
      }
      const valuesSql = sql.join(
        rows.map(
          (r) => sql`(${r.id}::uuid, ${r.billed}::bigint, ${r.pct}::numeric)`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        update ${sovLineItems} as li
           set billed_cents = v.billed,
               percent_complete = v.pct,
               updated_at = now()
          from (values ${valuesSql}) as v(id, billed, pct)
         where li.id = v.id
      `);
    }

    await tx
      .update(trackerInvoices)
      .set({ appliedAt: new Date(), updatedAt: new Date() })
      .where(eq(trackerInvoices.id, invoiceId));
  });
  // Observability: surfaces the batch size + wall time so a regression
  // (e.g. accidentally re-introducing per-row UPDATEs) shows up in logs.
  if (matches.length >= 25) {
    // eslint-disable-next-line no-console
    console.log(
      `[financials] applyInvoiceMatches invoice=${invoiceId} matches=${matches.length} took=${Date.now() - startedAt}ms`,
    );
  }
}

/**
 * Single batched ownership check for a list of SOV line items: every id
 * MUST belong to a tracker for the given job. Returns nothing on success;
 * throws 403/404 otherwise. Replaces a per-id `assertLineItemInJob` loop
 * (Task #277) so PATCH matches with N rows costs one query instead of N.
 */
async function assertLineItemsInJob(lineItemIds: string[], jobId: string) {
  const uniqueIds = Array.from(new Set(lineItemIds));
  if (uniqueIds.length === 0) return;
  const rows = await db
    .select({ id: sovLineItems.id })
    .from(sovLineItems)
    .innerJoin(sovAreas, eq(sovLineItems.areaId, sovAreas.id))
    .innerJoin(financialTrackers, eq(sovAreas.trackerId, financialTrackers.id))
    .where(
      and(
        inArray(sovLineItems.id, uniqueIds),
        eq(financialTrackers.jobId, jobId),
      ),
    );
  if (rows.length !== uniqueIds.length) {
    throw new HttpError(
      403,
      "One or more line items do not belong to this job.",
    );
  }
}

router.post(
  "/:jobId/financials/invoices",
  aiParseRateLimit,
  uploadSingle("file"),
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);

    const upload = (req.file ?? null) as Express.Multer.File | null;
    if (!upload) throw new HttpError(400, "Missing invoice file.");
    const isImage = (upload.mimetype ?? "").toLowerCase().startsWith("image/");
    try {
      validateUploadForMediaType(isImage ? "photo" : "document", upload);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "Unsupported invoice file type.");
    }
    const tracker = await getOrCreateTracker(jobId, req.auth!.userId);

    // Read bytes BEFORE saveUploadedFiles consumes the multer temp file.
    let bytes: Buffer;
    if (upload.buffer && upload.buffer.length > 0) {
      bytes = upload.buffer;
    } else if (upload.path) {
      bytes = await fsp.readFile(upload.path);
    } else {
      throw new HttpError(500, "Could not read uploaded invoice.");
    }

    // Persist file to FINANCIALS folder.
    let fileId: string | null = null;
    const financialsFolderId = await findFinancialsFolderId(jobId);
    if (financialsFolderId) {
      const saved = await saveUploadedFiles({
        folderId: financialsFolderId,
        userId: req.auth!.userId,
        uploadedFiles: [upload],
        note: "AI-matched invoice",
      });
      fileId = saved.files[0]?.id ?? null;
    }

    // Build SOV summary for the AI.
    const sovItems = await db
      .select({
        id: sovLineItems.id,
        description: sovLineItems.description,
        scheduledValueCents: sovLineItems.scheduledValueCents,
        billedCents: sovLineItems.billedCents,
        areaName: sovAreas.name,
      })
      .from(sovLineItems)
      .innerJoin(sovAreas, eq(sovLineItems.areaId, sovAreas.id))
      .where(and(eq(sovAreas.trackerId, tracker.id), eq(sovLineItems.isRemoved, false)));

    const sovSummary = sovItems.map((li) => ({
      id: li.id,
      area: li.areaName,
      description: li.description,
      scheduledValueCents: Number(li.scheduledValueCents ?? 0),
      remainingCents: Math.max(
        0,
        Number(li.scheduledValueCents ?? 0) - Number(li.billedCents ?? 0),
      ),
    }));

    const invoiceContent: ContentBlockParam[] = await buildAnthropicContent(
      upload,
      bytes,
    );
    invoiceContent.push({
      type: "text",
      text: `Schedule of Values:\n${JSON.stringify(sovSummary, null, 2)}\n\nReturn the JSON described above.`,
    });

    const aiResp = await callAnthropicWithLogging({
      event: "ai.invoice.parse",
      jobId,
      request: {
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: INVOICE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: invoiceContent }],
      },
    });

    const textBlock = aiResp.content.find(
      (b: { type: string }) => b.type === "text",
    ) as { type: "text"; text: string } | undefined;
    if (!textBlock) throw new HttpError(502, "AI returned no text.");
    const parsed = extractJson(textBlock.text);
    const validated = invoiceAiSchema.safeParse(parsed);
    if (!validated.success) {
      throw new HttpError(502, "AI invoice response did not match expected shape.", {
        issues: validated.error.flatten(),
      });
    }

    const validIds = new Set(sovSummary.map((s) => s.id));
    const cleanMatches = validated.data.matches.filter((m) => validIds.has(m.sovLineItemId));

    const [invoice] = await db
      .insert(trackerInvoices)
      .values({
        trackerId: tracker.id,
        invoiceNumber: validated.data.invoiceNumber ?? null,
        invoiceDate: validated.data.invoiceDate ?? null,
        totalCents: validated.data.totalCents ?? 0,
        fileId,
        rawAiResponse: parsed as Record<string, unknown>,
        createdBy: req.auth!.userId,
      })
      .returning();

    await applyInvoiceMatches(invoice.id, cleanMatches);

    await writeActivity({
      entityType: "job",
      entityId: jobId,
      action: "financials.invoice_applied",
      userId: req.auth!.userId,
      jobId,
      description: `Applied invoice ${validated.data.invoiceNumber ?? "(no #)"}`,
    });

    const data = await loadTrackerWithChildren(tracker.id);
    res.status(201).json({ invoiceId: invoice.id, ...data });
  }),
);

const invoiceMatchesPatchSchema = z.object({
  matches: z
    .array(
      z.object({
        sovLineItemId: z.string().uuid(),
        amountCents: z.coerce.number().int().nonnegative(),
      }),
    )
    .default([]),
});

router.patch(
  "/:jobId/financials/invoices/:invoiceId/matches",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const invoiceId = getParam(req.params.invoiceId, "invoice id");
    await assertInvoiceInJob(invoiceId, jobId);
    const body = invoiceMatchesPatchSchema.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Invalid matches.", body.error.flatten());
    // Single batched ownership check: every referenced line item must
    // belong to this job's tracker. Replaces the prior O(N) loop of
    // `assertLineItemInJob` (Task #277).
    await assertLineItemsInJob(
      body.data.matches.map((m) => m.sovLineItemId),
      jobId,
    );
    await applyInvoiceMatches(invoiceId, body.data.matches);
    const tracker = await getOrCreateTracker(jobId, req.auth!.userId);
    const data = await loadTrackerWithChildren(tracker.id);
    res.json(data);
  }),
);

router.delete(
  "/:jobId/financials/invoices/:invoiceId",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);
    const invoiceId = getParam(req.params.invoiceId, "invoice id");
    await assertInvoiceInJob(invoiceId, jobId);
    // Reverse payments by setting matches to [], then delete the invoice.
    await applyInvoiceMatches(invoiceId, []);
    await db.delete(trackerInvoices).where(eq(trackerInvoices.id, invoiceId));
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Tracker totals helper exposed to the rest of the codebase (used by
// jobs.ts and clients.ts to roll up AR up to the client level).
// ---------------------------------------------------------------------------

export type TrackerTotals = {
  jobId: string;
  trackerId: string;
  scheduledValueCents: number;
  billedCents: number;
  changeOrderApprovedCents: number;
  contractWithChangesCents: number;
  outstandingCents: number;
};

export async function getTrackerTotalsByJobIds(
  jobIds: string[],
): Promise<Map<string, TrackerTotals>> {
  const result = new Map<string, TrackerTotals>();
  if (jobIds.length === 0) return result;

  const trackers = await db
    .select({ id: financialTrackers.id, jobId: financialTrackers.jobId })
    .from(financialTrackers)
    .where(inArray(financialTrackers.jobId, jobIds));
  if (trackers.length === 0) return result;

  const trackerIds = trackers.map((t) => t.id);

  const [lineSums, coSums] = await Promise.all([
    db
      .select({
        trackerId: sovAreas.trackerId,
        scheduled: sql<number>`coalesce(sum(case when ${sovLineItems.isRemoved} then 0 else ${sovLineItems.scheduledValueCents} end), 0)`,
        billed: sql<number>`coalesce(sum(case when ${sovLineItems.isRemoved} then 0 else ${sovLineItems.billedCents} end), 0)`,
      })
      .from(sovLineItems)
      .innerJoin(sovAreas, eq(sovLineItems.areaId, sovAreas.id))
      .where(inArray(sovAreas.trackerId, trackerIds))
      .groupBy(sovAreas.trackerId),
    db
      .select({
        trackerId: changeOrders.trackerId,
        approved: sql<number>`coalesce(sum(case when ${changeOrders.status} = 'approved' then ${changeOrders.amountCents} else 0 end), 0)`,
      })
      .from(changeOrders)
      .where(inArray(changeOrders.trackerId, trackerIds))
      .groupBy(changeOrders.trackerId),
  ]);

  const linesByTracker = new Map<string, { scheduled: number; billed: number }>();
  for (const r of lineSums) {
    linesByTracker.set(r.trackerId, {
      scheduled: Number(r.scheduled ?? 0),
      billed: Number(r.billed ?? 0),
    });
  }
  const coByTracker = new Map<string, number>();
  for (const r of coSums) {
    coByTracker.set(r.trackerId, Number(r.approved ?? 0));
  }

  for (const t of trackers) {
    const lines = linesByTracker.get(t.id) ?? { scheduled: 0, billed: 0 };
    const coTotal = coByTracker.get(t.id) ?? 0;
    const contractWithChanges = lines.scheduled + coTotal;
    result.set(t.jobId, {
      jobId: t.jobId,
      trackerId: t.id,
      scheduledValueCents: lines.scheduled,
      billedCents: lines.billed,
      changeOrderApprovedCents: coTotal,
      contractWithChangesCents: contractWithChanges,
      outstandingCents: Math.max(0, contractWithChanges - lines.billed),
    });
  }

  return result;
}

export default router;
