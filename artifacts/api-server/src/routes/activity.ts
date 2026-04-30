import { z } from "zod";
import { Router, type IRouter } from "express";
import { listAccessibleJobIds, listAccessibleLeadIds } from "../lib/authorization";
import { getActivityEntries } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";
import { decodeCursor, encodeCursor, isCursorModeRequested } from "../lib/cursor";

const router: IRouter = Router();

const querySchema = z.object({
  jobId: z.string().uuid().optional(),
  mediaType: z.enum(["document", "photo", "video"]).optional(),
  folderId: z.string().uuid().optional(),
  entityType: z.string().trim().min(1).optional(),
  entityId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
}).superRefine((value, ctx) => {
  if ((value.entityType && !value.entityId) || (!value.entityType && value.entityId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "entityType and entityId must be provided together.",
      path: ["entityType"],
    });
  }

  if ((value.mediaType || value.folderId) && !value.jobId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "jobId is required when filtering by mediaType or folderId.",
      path: ["jobId"],
    });
  }
});

router.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const query = querySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid activity query.", query.error.flatten());
    }

    const [accessibleJobIds, accessibleLeadIds] = await Promise.all([
      listAccessibleJobIds(req.auth!),
      listAccessibleLeadIds(req.auth!),
    ]);
    const noJobAccess = accessibleJobIds !== null && accessibleJobIds.length === 0;
    const noLeadAccess = accessibleLeadIds !== null && accessibleLeadIds.length === 0;

    const isCursorMode = isCursorModeRequested(req.query as Record<string, unknown>);
    const cursorPayload = query.data.cursor ? decodeCursor(query.data.cursor) : null;
    const cursor = cursorPayload
      ? { createdAt: String(cursorPayload.k[0] ?? ""), id: cursorPayload.id }
      : null;

    if (noJobAccess && noLeadAccess) {
      if (isCursorMode) {
        res.json({
          data: [],
          pagination: { limit: query.data.limit ?? 50, hasMore: false, nextCursor: null },
        });
        return;
      }
      res.json({
        data: [],
        pagination: {
          page: query.data.page ?? 1,
          limit: query.data.limit ?? 50,
          total: 0,
          totalItems: 0,
          totalPages: 1,
        },
      });
      return;
    }

    if (query.data.jobId && accessibleJobIds && !accessibleJobIds.includes(query.data.jobId)) {
      throw new HttpError(403, "You do not have access to that activity feed.");
    }

    const result = await getActivityEntries({
      jobId: query.data.jobId ?? null,
      mediaType: query.data.mediaType ?? null,
      folderId: query.data.folderId ?? null,
      entityType: query.data.entityType ?? null,
      entityId: query.data.entityId ?? null,
      allowedJobIds: accessibleJobIds,
      allowedLeadIds: accessibleLeadIds,
      page: query.data.page,
      limit: query.data.limit,
      cursor,
      isCursorMode,
    });

    if (isCursorMode && "nextCursor" in result.pagination) {
      const next = result.pagination.nextCursor;
      const encoded = next ? encodeCursor({ v: 1, k: [next.createdAt], id: next.id }) : null;
      res.json({
        data: result.data,
        pagination: {
          limit: result.pagination.limit,
          hasMore: result.pagination.hasMore,
          nextCursor: encoded,
        },
      });
      return;
    }

    res.json(result);
  }),
);

export default router;
