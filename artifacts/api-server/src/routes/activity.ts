import { z } from "zod";
import { Router, type IRouter } from "express";
import { getActivityEntries } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";

const router: IRouter = Router();

const querySchema = z.object({
  jobId: z.string().uuid(),
  mediaType: z.enum(["document", "photo", "video"]).optional(),
  folderId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

router.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const query = querySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid activity query.", query.error.flatten());
    }

    const entries = await getActivityEntries({
      jobId: query.data.jobId,
      mediaType: query.data.mediaType ?? null,
      folderId: query.data.folderId ?? null,
      limit: query.data.limit,
    });

    res.json({ entries });
  }),
);

export default router;
