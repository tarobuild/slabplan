import { z } from "zod";
import { Router, type IRouter } from "express";
import {
  assertCanManageFile,
  assertCanUploadToFolder,
  assertCanViewFile,
  assertCanViewFolder,
} from "../lib/authorization";
import {
  createResourceFolder,
  getFileOrThrow,
  listFilesForFolder,
  listResourceFolders,
  saveUploadedFiles,
  softDeleteFile,
} from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";
import { requireAdmin } from "../middleware/require-auth";
import { streamStoredFileToResponse } from "../lib/storage";
import { uploadArray } from "../lib/uploads";

const router: IRouter = Router();

const folderListQuerySchema = z.object({
  parentId: z.string().uuid().optional(),
  all: z.coerce.boolean().optional().default(false),
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
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format, expected YYYY-MM-DD.").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format, expected YYYY-MM-DD.").optional(),
  sortBy: z.string().optional().default("modified_newest"),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(100),
});

const resourceFolderBodySchema = z.object({
  title: z.string().trim().min(1).max(255),
  parentFolderId: z.string().uuid().nullable().optional().default(null),
});

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new HttpError(400, `Missing ${label}.`);
  }

  return normalized;
}

router.get(
  "/resources/folders",
  asyncHandler(async (req, res) => {
    const query = folderListQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid resource folder query.", query.error.flatten());
    }

    const result = await listResourceFolders({
      parentId: query.data.parentId ?? null,
      all: query.data.all,
    });

    res.json(result);
  }),
);

router.post(
  "/resources/folders",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = resourceFolderBodySchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid resource folder payload.", body.error.flatten());
    }

    const folder = await createResourceFolder({
      parentFolderId: body.data.parentFolderId,
      title: body.data.title,
      userId: req.auth!.userId,
    });

    res.status(201).json({ folder });
  }),
);

router.get(
  "/resources/folders/:id/files",
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
      page: query.data.page,
      limit: query.data.limit,
    });

    res.json(result);
  }),
);

router.post(
  "/resources/folders/:id/upload",
  requireAdmin,
  uploadArray("files", 20),
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolder(req.auth!, folderId);

    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    const result = await saveUploadedFiles({
      folderId,
      userId: req.auth!.userId,
      uploadedFiles,
      note: null,
    });

    res.status(201).json(result);
  }),
);

router.delete(
  "/resources/files/:id",
  requireAdmin,
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

router.get(
  "/resources/folders/:folderId/files/:fileId/view",
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.folderId, "folder id");
    const fileId = getParam(req.params.fileId, "file id");

    const folder = await assertCanViewFolder(req.auth!, folderId);

    if (folder.jobId) {
      throw new HttpError(400, "Not a resource folder.");
    }

    await assertCanViewFile(req.auth!, fileId);

    const file = await getFileOrThrow(fileId);

    if (file.folderId !== folderId) {
      throw new HttpError(404, "File not found.");
    }

    if (!file.fileUrl) {
      throw new HttpError(404, "Stored file missing.");
    }

    const displayName = file.originalName ?? file.filename;
    await streamStoredFileToResponse(res, file.fileUrl, {
      disposition: "inline",
      filename: displayName,
      contentType: file.mimeType,
    });
  }),
);

export default router;
