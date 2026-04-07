import { z } from "zod";
import { Router, type IRouter } from "express";
import {
  copyFolder,
  createFolder,
  emptyTrash,
  listFoldersForJob,
  listTrash,
  moveFolder,
  purgeFolder,
  renameOrUpdateFolder,
  restoreFolder,
  softDeleteFolder,
  streamFolderZip,
} from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";

const router: IRouter = Router();

const folderListQuerySchema = z.object({
  mediaType: z.enum(["document", "photo", "video"]),
  parentId: z.string().uuid().optional(),
  all: z.coerce.boolean().optional().default(false),
});

const folderBodySchema = z.object({
  title: z.string().trim().min(1).max(255),
  mediaType: z.enum(["document", "photo", "video"]),
  parentFolderId: z.string().uuid().nullable().optional().default(null),
});

const folderUpdateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  viewingPermissions: z.record(z.string(), z.unknown()).nullable().optional(),
  uploadingPermissions: z.record(z.string(), z.unknown()).nullable().optional(),
});

const moveFolderSchema = z.object({
  destinationFolderId: z.string().uuid().nullable().optional().default(null),
});

const trashQuerySchema = z.object({
  mediaType: z.enum(["document", "photo", "video"]),
});

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new HttpError(400, `Missing ${label}.`);
  }

  return normalized;
}

router.get(
  "/jobs/:jobId/folders",
  asyncHandler(async (req, res) => {
    const query = folderListQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid folder query.", query.error.flatten());
    }

    const result = await listFoldersForJob({
      jobId: getParam(req.params.jobId, "job id"),
      mediaType: query.data.mediaType,
      parentId: query.data.parentId ?? null,
      all: query.data.all,
    });

    res.json(result);
  }),
);

router.post(
  "/jobs/:jobId/folders",
  asyncHandler(async (req, res) => {
    const body = folderBodySchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid folder payload.", body.error.flatten());
    }

    const folder = await createFolder({
      jobId: getParam(req.params.jobId, "job id"),
      mediaType: body.data.mediaType,
      parentFolderId: body.data.parentFolderId,
      title: body.data.title,
      userId: req.auth.userId,
    });

    res.status(201).json({ folder });
  }),
);

router.put(
  "/folders/:id",
  asyncHandler(async (req, res) => {
    const body = folderUpdateSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid folder update payload.", body.error.flatten());
    }

    const folder = await renameOrUpdateFolder({
      folderId: getParam(req.params.id, "folder id"),
      title: body.data.title ?? null,
      viewingPermissions: body.data.viewingPermissions,
      uploadingPermissions: body.data.uploadingPermissions,
      userId: req.auth.userId,
    });

    res.json({ folder });
  }),
);

router.delete(
  "/folders/:id",
  asyncHandler(async (req, res) => {
    await softDeleteFolder({
      folderId: getParam(req.params.id, "folder id"),
      userId: req.auth.userId,
    });

    res.json({ success: true });
  }),
);

router.post(
  "/folders/:id/copy",
  asyncHandler(async (req, res) => {
    const folder = await copyFolder({
      folderId: getParam(req.params.id, "folder id"),
      userId: req.auth.userId,
    });

    res.status(201).json({ folder });
  }),
);

router.put(
  "/folders/:id/move",
  asyncHandler(async (req, res) => {
    const body = moveFolderSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid move folder payload.", body.error.flatten());
    }

    const folder = await moveFolder({
      folderId: getParam(req.params.id, "folder id"),
      destinationFolderId: body.data.destinationFolderId,
      userId: req.auth.userId,
    });

    res.json({ folder });
  }),
);

router.post(
  "/folders/:id/restore",
  asyncHandler(async (req, res) => {
    const folder = await restoreFolder({
      folderId: getParam(req.params.id, "folder id"),
      userId: req.auth.userId,
    });

    res.json({ folder });
  }),
);

router.delete(
  "/folders/:id/purge",
  asyncHandler(async (req, res) => {
    await purgeFolder({
      folderId: getParam(req.params.id, "folder id"),
      userId: req.auth.userId,
    });

    res.json({ success: true });
  }),
);

router.get(
  "/folders/:id/download",
  asyncHandler(async (req, res) => {
    await streamFolderZip({
      folderId: getParam(req.params.id, "folder id"),
      res,
    });
  }),
);

router.get(
  "/jobs/:jobId/trash",
  asyncHandler(async (req, res) => {
    const query = trashQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid trash query.", query.error.flatten());
    }

    const items = await listTrash({
      jobId: getParam(req.params.jobId, "job id"),
      mediaType: query.data.mediaType,
    });

    res.json(items);
  }),
);

router.delete(
  "/jobs/:jobId/trash",
  asyncHandler(async (req, res) => {
    const query = trashQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid trash query.", query.error.flatten());
    }

    await emptyTrash({
      jobId: getParam(req.params.jobId, "job id"),
      mediaType: query.data.mediaType,
      userId: req.auth.userId,
    });

    res.json({ success: true });
  }),
);

export default router;
