import { z } from "zod";
import { Router, type IRouter } from "express";
import { getActivityEntries } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";

const router: IRouter = Router();

const querySchema = z.object({
  jobId: z.string().uuid().optional(),
  mediaType: z.enum(["document", "photo", "video"]).optional(),
  folderId: z.string().uuid().optional(),
  entityType: z.string().trim().min(1).optional(),
  entityId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
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

    const result = await getActivityEntries({
      jobId: query.data.jobId ?? null,
      mediaType: query.data.mediaType ?? null,
      folderId: query.data.folderId ?? null,
      entityType: query.data.entityType ?? null,
      entityId: query.data.entityId ?? null,
      page: query.data.page,
      limit: query.data.limit,
    });

    res.json(result);
  }),
);

export default router;
