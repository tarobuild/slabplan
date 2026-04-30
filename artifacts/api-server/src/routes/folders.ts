import { z } from "zod";
import { Router, type IRouter } from "express";
import {
  assertCanAccessJob,
  assertCanManageJob,
  assertCanUploadToFolder,
  assertCanViewFolder,
} from "../lib/authorization";
import {
  copyFolder,
  createFolder,
  emptyTrash,
  getFolderOrThrow,
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
import { requireManagerOrAbove } from "../middleware/require-auth";

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

const folderPermissionSchema = z.record(
  z.enum(["admin", "project_manager", "crew_member", "internal"]),
  z.boolean(),
);

const folderUpdateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  viewingPermissions: folderPermissionSchema.nullable().optional(),
  uploadingPermissions: folderPermissionSchema.nullable().optional(),
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

    const jobId = getParam(req.params.jobId, "job id");
    await assertCanAccessJob(req.auth!, jobId);

    const result = await listFoldersForJob({
      jobId,
      mediaType: query.data.mediaType,
      parentId: query.data.parentId ?? null,
      all: query.data.all,
    });

    res.json(result);
  }),
);

router.post(
  "/jobs/:jobId/folders",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const body = folderBodySchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid folder payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);

    const folder = await createFolder({
      jobId,
      mediaType: body.data.mediaType,
      parentFolderId: body.data.parentFolderId,
      title: body.data.title,
      userId: req.auth!.userId,
    });

    res.status(201).json({ folder });
  }),
);

router.get(
  "/folders/:id",
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanViewFolder(req.auth!, folderId);

    const folder = await getFolderOrThrow(folderId);
    res.json({ folder });
  }),
);

router.put(
  "/folders/:id",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const body = folderUpdateSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid folder update payload.", body.error.flatten());
    }

    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolder(req.auth!, folderId);

    const folder = await renameOrUpdateFolder({
      folderId,
      title: body.data.title ?? null,
      viewingPermissions: body.data.viewingPermissions,
      uploadingPermissions: body.data.uploadingPermissions,
      userId: req.auth!.userId,
    });

    res.json({ folder });
  }),
);

router.delete(
  "/folders/:id",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolder(req.auth!, folderId);

    await softDeleteFolder({
      folderId,
      userId: req.auth!.userId,
    });

    res.json({ success: true });
  }),
);

router.post(
  "/folders/:id/copy",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolder(req.auth!, folderId);

    const folder = await copyFolder({
      folderId,
      userId: req.auth!.userId,
    });

    res.status(201).json({ folder });
  }),
);

router.put(
  "/folders/:id/move",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const body = moveFolderSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid move folder payload.", body.error.flatten());
    }

    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolder(req.auth!, folderId);

    const folder = await moveFolder({
      folderId,
      destinationFolderId: body.data.destinationFolderId,
      userId: req.auth!.userId,
    });

    res.json({ folder });
  }),
);

router.post(
  "/folders/:id/restore",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolder(req.auth!, folderId, true);

    const folder = await restoreFolder({
      folderId,
      userId: req.auth!.userId,
    });

    res.json({ folder });
  }),
);

router.delete(
  "/folders/:id/purge",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolder(req.auth!, folderId, true);

    await purgeFolder({
      folderId,
      userId: req.auth!.userId,
    });

    res.json({ success: true });
  }),
);

router.get(
  "/folders/:id/download",
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanViewFolder(req.auth!, folderId);

    await streamFolderZip({
      folderId,
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

    const jobId = getParam(req.params.jobId, "job id");
    await assertCanAccessJob(req.auth!, jobId);

    const items = await listTrash({
      jobId,
      mediaType: query.data.mediaType,
    });

    res.json(items);
  }),
);

router.delete(
  "/jobs/:jobId/trash",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const query = trashQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid trash query.", query.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    await assertCanManageJob(req.auth!, jobId);

    await emptyTrash({
      jobId,
      mediaType: query.data.mediaType,
      userId: req.auth!.userId,
    });

    res.json({ success: true });
  }),
);

export default router;
