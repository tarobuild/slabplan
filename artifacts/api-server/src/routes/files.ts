import { promises as fs } from "node:fs";
import multer from "multer";
import { z } from "zod";
import { Router, type IRouter } from "express";
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

    const result = await listFilesForFolder({
      folderId: getParam(req.params.id, "folder id"),
      search: query.data.search?.trim() || null,
      uploadedBy: query.data.uploadedBy ?? null,
      fileTypes: query.data.fileTypes,
      from: query.data.from?.trim() || null,
      to: query.data.to?.trim() || null,
      sortBy: query.data.sortBy,
      includeDeleted: query.data.includeDeleted,
    });

    res.json(result);
  }),
);

router.post(
  "/folders/:id/files",
  upload.array("files", 20),
  asyncHandler(async (req, res) => {
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    const result = await saveUploadedFiles({
      folderId: getParam(req.params.id, "folder id"),
      userId: req.auth.userId,
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

    const file = await renameFile({
      fileId: getParam(req.params.id, "file id"),
      originalName: body.data.originalName,
      userId: req.auth.userId,
    });

    res.json({ file });
  }),
);

router.delete(
  "/files/:id",
  asyncHandler(async (req, res) => {
    await softDeleteFile({
      fileId: getParam(req.params.id, "file id"),
      userId: req.auth.userId,
    });

    res.json({ success: true });
  }),
);

router.post(
  "/files/:id/restore",
  asyncHandler(async (req, res) => {
    const file = await restoreFile({
      fileId: getParam(req.params.id, "file id"),
      userId: req.auth.userId,
    });

    res.json({ file });
  }),
);

router.delete(
  "/files/:id/purge",
  asyncHandler(async (req, res) => {
    await purgeFile({
      fileId: getParam(req.params.id, "file id"),
      userId: req.auth.userId,
    });

    res.json({ success: true });
  }),
);

router.get(
  "/files/:id/download",
  asyncHandler(async (req, res) => {
    const file = await getFileOrThrow(getParam(req.params.id, "file id"), true);

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
