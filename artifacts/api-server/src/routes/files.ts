import { promises as fs } from "node:fs";
import multer from "multer";
import { z } from "zod";
import { Router, type IRouter } from "express";
import {
  assertCanManageFile,
  assertCanUploadToFolder,
  assertCanViewFile,
  assertCanViewFolder,
} from "../lib/authorization";
import { getFileOrThrow, listFilesForFolder, purgeFile, renameFile, restoreFile, saveUploadedFiles, softDeleteFile } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";
import { resolveAbsolutePathFromFileUrl } from "../lib/storage";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 200,
    files: 20,
  },
});

const fileListQuerySchema = z.object({
  search: z.string().optional(),
  uploadedBy: z.string().uuid().optional(),
  fileTypes: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) {
        return [];
      }

      return Array.isArray(value)
        ? value.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean)
        : value.split(",").map((item) => item.trim()).filter(Boolean);
    }),
  from: z.string().optional(),
  to: z.string().optional(),
  sortBy: z.string().optional().default("modified_newest"),
  includeDeleted: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(100),
});

const renameFileSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
});

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new HttpError(400, `Missing ${label}.`);
  }

  return normalized;
}

router.get(
  "/folders/:id/files",
  asyncHandler(async (req, res) => {
    const query = fileListQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid file list query.", query.error.flatten());
    }

    const folderId = getParam(req.params.id, "folder id");
    await assertCanViewFolder(req.auth!, folderId);

    const result = await listFilesForFolder({
      folderId,
      search: query.data.search?.trim() || null,
      uploadedBy: query.data.uploadedBy ?? null,
      fileTypes: query.data.fileTypes,
      from: query.data.from?.trim() || null,
      to: query.data.to?.trim() || null,
      sortBy: query.data.sortBy,
      includeDeleted: query.data.includeDeleted,
      page: query.data.page,
      limit: query.data.limit,
    });

    res.json(result);
  }),
);

router.post(
  "/folders/:id/files",
  upload.array("files", 20),
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolder(req.auth!, folderId);

    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    const result = await saveUploadedFiles({
      folderId,
      userId: req.auth!.userId,
      uploadedFiles,
    });

    res.status(201).json(result);
  }),
);

router.put(
  "/files/:id",
  asyncHandler(async (req, res) => {
    const body = renameFileSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid file payload.", body.error.flatten());
    }

    const fileId = getParam(req.params.id, "file id");
    await assertCanManageFile(req.auth!, fileId);

    const file = await renameFile({
      fileId,
      originalName: body.data.originalName,
      userId: req.auth!.userId,
    });

    res.json({ file });
  }),
);

router.delete(
  "/files/:id",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    await assertCanManageFile(req.auth!, fileId);

    await softDeleteFile({
      fileId,
      userId: req.auth!.userId,
    });

    res.json({ success: true });
  }),
);

router.post(
  "/files/:id/restore",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    await assertCanManageFile(req.auth!, fileId);

    const file = await restoreFile({
      fileId,
      userId: req.auth!.userId,
    });

    res.json({ file });
  }),
);

router.delete(
  "/files/:id/purge",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    await assertCanManageFile(req.auth!, fileId);

    await purgeFile({
      fileId,
      userId: req.auth!.userId,
    });

    res.json({ success: true });
  }),
);

router.get(
  "/files/:id/download",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    await assertCanViewFile(req.auth!, fileId, true);
    const file = await getFileOrThrow(fileId, true);

    if (!file.fileUrl) {
      throw new HttpError(404, "Stored file missing.");
    }

    const absolutePath = resolveAbsolutePathFromFileUrl(file.fileUrl);

    try {
      await fs.access(absolutePath);
    } catch {
      throw new HttpError(404, "Stored file missing.");
    }

    res.download(absolutePath, file.originalName);
  }),
);

export default router;
