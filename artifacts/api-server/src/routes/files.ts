import { z } from "zod";
import { Router, type IRouter } from "express";
import {
  assertCanAccessJob,
  assertCanCreateJobFolder,
  assertCanManageFile,
  assertCanUploadToFolder,
  assertCanViewFile,
  assertCanViewFolder,
  type AuthContext,
} from "../lib/authorization";
import {
  FILE_VIEW_TOKEN_TTL_SECONDS,
  signFileViewToken,
  toPublicUser,
} from "../lib/auth";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { decodeCursor, isCursorModeRequested } from "../lib/cursor";
import { sanitizeDownloadFilename } from "../lib/downloads";
import {
  copyFiles,
  detectFileDuplicate,
  duplicateActionValues,
  getFileOrThrow,
  listFilesForFolder,
  moveFile,
  moveFiles,
  purgeFile,
  renameFile,
  resolveJobFolderPath,
  restoreFile,
  saveUploadedFiles,
  softDeleteFile,
  softDeleteFiles,
  streamSelectedFilesZip,
} from "../lib/file-manager";
import {
  TOOL_TYPES,
  createAnnotation,
  getAnnotationOrThrow,
  listAnnotationsForFile,
  softDeleteAnnotation,
  updateAnnotation,
} from "../lib/file-annotations";
import { isAdmin } from "../lib/authorization";
import { withFileViewLogging } from "../lib/file-view-log";
import { HttpError, asyncHandler } from "../lib/http";
import { streamPreparedStoredFileToResponse } from "../lib/storage";
import { cleanupTempUpload, uploadArray } from "../lib/uploads";
import { createUploadPerUserRateLimit } from "../lib/rate-limit";
import { assertActiveUserById } from "../lib/active-user";
import { stringBoolean } from "../lib/zod-helpers";
import {
  assembleChunkedUpload,
  assertChunkedUploadAccess,
  createChunkedUploadSession,
  getChunkedUploadSession,
  getChunkedUploadStatus,
  isBase64ChunkRequest,
  removeChunkedUploadSession,
  writeBase64ChunkFromRequest,
  writeChunkFromRequest,
} from "../lib/chunked-upload";
import { validateMagicBytesForFiles } from "../lib/upload-magic-bytes";
import { validateVideoDurationsForFiles } from "../lib/upload-video-duration";

const uploadRateLimit = createUploadPerUserRateLimit();

const router: IRouter = Router();

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
  includeDeleted: stringBoolean.optional().default(false),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(100),
  cursor: z.string().optional(),
});

const renameFileSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
});

const moveFileSchema = z.object({
  destinationFolderId: z.string().uuid(),
});

const batchFileIdListSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(250)
  .transform((fileIds) => Array.from(new Set(fileIds)));

const batchFilesSchema = z.object({
  fileIds: batchFileIdListSchema,
});

const batchFilesDestinationSchema = batchFilesSchema.extend({
  destinationFolderId: z.string().uuid(),
});

const duplicateActionSchema = z.enum(duplicateActionValues).optional().default("keep_both");

const booleanMultipartField = z
  .union([z.boolean(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return false;
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  });

const pathSegmentsField = z
  .union([z.array(z.string()), z.string(), z.null(), z.undefined()])
  .transform((value): string[] | null => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || value.trim().length === 0) return null;
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((segment) => String(segment));
        }
      } catch {
        return null;
      }
    }
    return trimmed.split("/");
  });

// Per-file video durations the client probed at selection time. Sent as
// a JSON-encoded array of (number | null), one entry per `files`
// upload in the same order. Anything we can't parse is treated as if
// the client never sent it — duration is purely a UX hint, never
// authoritative, so a malformed payload should not block the upload.
const videoDurationsField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value): Array<number | null> | null => {
    if (typeof value !== "string" || value.trim().length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    return parsed.map((entry) =>
      typeof entry === "number" && Number.isFinite(entry) && entry > 0 ? entry : null,
    );
  });

const uploadFilesSchema = z.object({
  note: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (typeof value !== "string") {
        return null;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
  videoDurations: videoDurationsField.optional(),
  duplicateAction: duplicateActionSchema,
});

const duplicateQuerySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  size: z.coerce.number().int().nonnegative().optional(),
  checksum: z.string().trim().regex(/^[a-fA-F0-9]{64}$/).optional(),
});

const uploadFilesByPathSchema = uploadFilesSchema.extend({
  mediaType: z.enum(["document", "photo", "video"]).default("document"),
  folderPath: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).optional(),
  pathSegments: pathSegmentsField.optional(),
  createIfMissing: booleanMultipartField.optional().default(false),
}).refine((value) => value.folderPath || value.path || value.pathSegments, {
  message: "folderPath, path, or pathSegments is required.",
  path: ["folderPath"],
});

const chunkedUploadStartSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(100).optional(),
  totalSize: z.coerce.number().int().positive(),
  totalChunks: z.coerce.number().int().positive(),
  contentHash: z.string().trim().regex(/^[a-fA-F0-9]{64}$/).optional(),
  note: uploadFilesSchema.shape.note.optional(),
  duplicateAction: duplicateActionSchema,
  videoDurationSeconds: z.coerce.number().positive().optional(),
});

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new HttpError(400, `Missing ${label}.`);
  }

  return normalized;
}

function getIntParam(value: string | string[] | undefined, label: string) {
  const raw = getParam(value, label);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new HttpError(400, `Invalid ${label}.`, { code: "INVALID_ROUTE_PARAM", param: label }, "validation");
  }
  return parsed;
}

async function assertCanUploadToFolderForUploadRoute(
  auth: AuthContext,
  folderId: string,
  endpoint = "POST /api/folders/{folderId}/files",
) {
  try {
    return await assertCanUploadToFolder(auth, folderId);
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 403) {
      throw new HttpError(
        403,
        error.message,
        {
          code: "UPLOAD_FOLDER_FORBIDDEN",
          folderId,
          endpoint,
          retryable: false,
        },
        error.type ?? "forbidden",
      );
    }
    throw error;
  }
}

router.get(
  "/folders/:id/files",
  asyncHandler(async (req, res) => {
    const query = fileListQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid file list query.", query.error.flatten());
    }

    const folderId = getParam(req.params.id, "folder id");

    if (query.data.includeDeleted) {
      await assertCanUploadToFolder(req.auth!, folderId);
    } else {
      await assertCanViewFolder(req.auth!, folderId);
    }

    const isCursorMode = isCursorModeRequested(req.query as Record<string, unknown>);
    const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : null;

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
      cursor,
      isCursorMode,
    });

    res.json(result);
  }),
);

router.get(
  "/folders/:id/files/duplicates",
  asyncHandler(async (req, res) => {
    const query = duplicateQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid duplicate lookup query.", query.error.flatten());
    }

    const folderId = getParam(req.params.id, "folder id");
    await assertCanViewFolder(req.auth!, folderId);

    const duplicate = await detectFileDuplicate({
      folderId,
      originalName: query.data.filename,
      fileSize: query.data.size ?? null,
      contentHash: query.data.checksum ?? null,
    });

    res.json({ duplicate });
  }),
);

router.post(
  "/folders/:id/files",
  uploadRateLimit,
  uploadArray("files", 20),
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    const folder = await assertCanUploadToFolderForUploadRoute(req.auth!, folderId);
    const body = uploadFilesSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid upload payload.", body.error.flatten());
    }

    if (folder.mediaType === "photo" && req.auth!.role === "crew_member" && !body.data.note) {
      throw new HttpError(400, "A note is required when crew members upload photos.");
    }

    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    const result = await saveUploadedFiles({
      folderId,
      userId: req.auth!.userId,
      uploadedFiles,
      note: body.data.note,
      duplicateAction: body.data.duplicateAction,
      videoDurationsSeconds: body.data.videoDurations ?? null,
    });

    res.status(201).json(result);
  }),
);

router.post(
  "/jobs/:jobId/files/by-path",
  uploadRateLimit,
  uploadArray("files", 20),
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    const body = uploadFilesByPathSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid path upload payload.", body.error.flatten());
    }

    await assertCanAccessJob(req.auth!, jobId);
    if (body.data.createIfMissing) {
      await assertCanCreateJobFolder(req.auth!, jobId, body.data.mediaType);
    }

    const resolved = await resolveJobFolderPath({
      jobId,
      mediaType: body.data.mediaType,
      path: body.data.folderPath ?? body.data.path ?? null,
      pathSegments: body.data.pathSegments ?? null,
      createIfMissing: body.data.createIfMissing,
      userId: req.auth!.userId,
    });
    const folder = await assertCanUploadToFolderForUploadRoute(
      req.auth!,
      resolved.folder.id,
      "POST /api/jobs/{jobId}/files/by-path",
    );

    if (folder.mediaType === "photo" && req.auth!.role === "crew_member" && !body.data.note) {
      throw new HttpError(400, "A note is required when crew members upload photos.");
    }

    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    const result = await saveUploadedFiles({
      folderId: folder.id,
      userId: req.auth!.userId,
      uploadedFiles,
      note: body.data.note,
      duplicateAction: body.data.duplicateAction,
      videoDurationsSeconds: body.data.videoDurations ?? null,
    });

    res.status(201).json({
      ...result,
      resolvedFolder: resolved,
    });
  }),
);

router.post(
  "/folders/:id/files/chunked",
  uploadRateLimit,
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    const folder = await assertCanUploadToFolderForUploadRoute(
      req.auth!,
      folderId,
      "POST /api/folders/{folderId}/files/chunked",
    );
    const body = chunkedUploadStartSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid chunked upload payload.", body.error.flatten());
    }

    if (folder.mediaType === "photo" && req.auth!.role === "crew_member" && !body.data.note) {
      throw new HttpError(400, "A note is required when crew members upload photos.");
    }

    const session = await createChunkedUploadSession({
      folderId,
      userId: req.auth!.userId,
      originalName: body.data.originalName,
      mimeType: body.data.mimeType,
      totalSize: body.data.totalSize,
      totalChunks: body.data.totalChunks,
      contentHash: body.data.contentHash ?? null,
      note: body.data.note,
      duplicateAction: body.data.duplicateAction,
      videoDurationSeconds: body.data.videoDurationSeconds ?? null,
    });

    res.status(201).json({
      session,
      status: await getChunkedUploadStatus(session),
    });
  }),
);

router.get(
  "/folders/:id/files/chunked/:uploadId",
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolderForUploadRoute(
      req.auth!,
      folderId,
      "GET /api/folders/{folderId}/files/chunked/{uploadId}",
    );
    const uploadId = getParam(req.params.uploadId, "upload id");
    const session = await getChunkedUploadSession(uploadId);
    assertChunkedUploadAccess(session, { folderId, userId: req.auth!.userId });

    res.json({
      session,
      status: await getChunkedUploadStatus(session),
    });
  }),
);

router.put(
  "/folders/:id/files/chunked/:uploadId/chunks/:chunkIndex",
  uploadRateLimit,
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolderForUploadRoute(
      req.auth!,
      folderId,
      "PUT /api/folders/{folderId}/files/chunked/{uploadId}/chunks/{chunkIndex}",
    );
    const uploadId = getParam(req.params.uploadId, "upload id");
    const chunkIndex = getIntParam(req.params.chunkIndex, "chunk index");
    const session = await getChunkedUploadSession(uploadId);
    assertChunkedUploadAccess(session, { folderId, userId: req.auth!.userId });

    const result = isBase64ChunkRequest(req)
      ? await writeBase64ChunkFromRequest(req, session, chunkIndex)
      : await writeChunkFromRequest(req, session, chunkIndex);
    res.json(result);
  }),
);

router.post(
  "/folders/:id/files/chunked/:uploadId/complete",
  uploadRateLimit,
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolderForUploadRoute(
      req.auth!,
      folderId,
      "POST /api/folders/{folderId}/files/chunked/{uploadId}/complete",
    );
    const uploadId = getParam(req.params.uploadId, "upload id");
    const session = await getChunkedUploadSession(uploadId);
    assertChunkedUploadAccess(session, { folderId, userId: req.auth!.userId });

    const uploadedFile = await assembleChunkedUpload(session);

    try {
      await validateMagicBytesForFiles([uploadedFile]);
      await validateVideoDurationsForFiles([uploadedFile]);
      const result = await saveUploadedFiles({
        folderId,
        userId: req.auth!.userId,
        uploadedFiles: [uploadedFile],
        note: session.note,
        duplicateAction: session.duplicateAction,
        videoDurationsSeconds: [session.videoDurationSeconds],
      });
      await removeChunkedUploadSession(uploadId);

      res.status(201).json({
        uploadId,
        status: result.uploadResults[0]?.status ?? "uploaded",
        ...result,
      });
    } catch (error) {
      await cleanupTempUpload(uploadedFile);
      throw error;
    }
  }),
);

router.delete(
  "/folders/:id/files/chunked/:uploadId",
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    await assertCanUploadToFolderForUploadRoute(
      req.auth!,
      folderId,
      "DELETE /api/folders/{folderId}/files/chunked/{uploadId}",
    );
    const uploadId = getParam(req.params.uploadId, "upload id");
    const session = await getChunkedUploadSession(uploadId);
    assertChunkedUploadAccess(session, { folderId, userId: req.auth!.userId });

    await removeChunkedUploadSession(uploadId);
    res.json({ success: true });
  }),
);

router.post(
  "/files/batch/delete",
  asyncHandler(async (req, res) => {
    const body = batchFilesSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid batch delete payload.", body.error.flatten());
    }

    await Promise.all(
      body.data.fileIds.map((fileId) => assertCanManageFile(req.auth!, fileId)),
    );

    const deleted = await softDeleteFiles({
      fileIds: body.data.fileIds,
      userId: req.auth!.userId,
    });

    res.json({ success: true, count: deleted.length, files: deleted });
  }),
);

router.post(
  "/files/batch/move",
  asyncHandler(async (req, res) => {
    const body = batchFilesDestinationSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid batch move payload.", body.error.flatten());
    }

    await Promise.all([
      ...body.data.fileIds.map((fileId) => assertCanManageFile(req.auth!, fileId)),
      assertCanUploadToFolder(req.auth!, body.data.destinationFolderId),
    ]);

    const moved = await moveFiles({
      fileIds: body.data.fileIds,
      destinationFolderId: body.data.destinationFolderId,
      userId: req.auth!.userId,
    });

    res.json({ success: true, count: moved.length, files: moved });
  }),
);

router.post(
  "/files/batch/copy",
  asyncHandler(async (req, res) => {
    const body = batchFilesDestinationSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid batch copy payload.", body.error.flatten());
    }

    await Promise.all([
      ...body.data.fileIds.map((fileId) => assertCanManageFile(req.auth!, fileId)),
      assertCanUploadToFolder(req.auth!, body.data.destinationFolderId),
    ]);

    const copied = await copyFiles({
      fileIds: body.data.fileIds,
      destinationFolderId: body.data.destinationFolderId,
      userId: req.auth!.userId,
    });

    res.json({ success: true, count: copied.length, files: copied });
  }),
);

router.post(
  "/files/batch/download",
  asyncHandler(async (req, res) => {
    const body = batchFilesSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid batch download payload.", body.error.flatten());
    }

    await Promise.all(
      body.data.fileIds.map((fileId) => assertCanViewFile(req.auth!, fileId)),
    );

    await streamSelectedFilesZip({
      fileIds: body.data.fileIds,
      res,
    });
  }),
);

router.get(
  "/files/:id",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    await assertCanViewFile(req.auth!, fileId);

    const file = await getFileOrThrow(fileId);
    res.json({ file });
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

router.put(
  "/files/:id/move",
  asyncHandler(async (req, res) => {
    const body = moveFileSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid move file payload.", body.error.flatten());
    }

    const fileId = getParam(req.params.id, "file id");
    await assertCanManageFile(req.auth!, fileId);
    // The destination must also be writable by the caller — otherwise an MCP
    // user could move a file into a folder they cannot upload to.
    await assertCanUploadToFolder(req.auth!, body.data.destinationFolderId);

    const file = await moveFile({
      fileId,
      destinationFolderId: body.data.destinationFolderId,
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
    await assertCanViewFile(req.auth!, fileId);
    const file = await getFileOrThrow(fileId);

    if (!file.fileUrl) {
      throw new HttpError(404, "Stored file missing.");
    }

    await streamPreparedStoredFileToResponse(res, file.fileUrl, {
      disposition: "attachment",
      filename: sanitizeDownloadFilename(file.originalName),
      contentType: file.mimeType,
      rangeHeader: req.headers.range ?? null,
    });
  }),
);

router.get(
  "/folders/:folderId/files/:fileId/view",
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.folderId, "folder id");
    const fileId = getParam(req.params.fileId, "file id");
    const requesterId = req.auth?.userId ?? null;

    await withFileViewLogging(
      req,
      {
        route: "/api/folders/:folderId/files/:fileId/view",
        fileId,
        getRequesterId: () => requesterId,
      },
      async (progress) => {
        await assertCanViewFolder(req.auth!, folderId);
        await assertCanViewFile(req.auth!, fileId);

        const file = await getFileOrThrow(fileId);

        if (file.folderId !== folderId) {
          throw new HttpError(404, "File not found.");
        }

        if (!file.fileUrl) {
          throw new HttpError(404, "Stored file missing.");
        }

        const displayName = file.originalName ?? file.filename;
        return streamPreparedStoredFileToResponse(
          res,
          file.fileUrl,
          {
            disposition: "inline",
            filename: displayName,
            contentType: file.mimeType,
            cacheControl: "private, no-store",
            rangeHeader: req.headers.range ?? null,
          },
          progress,
        );
      },
    );
  }),
);

router.get(
  "/files/:id/view",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    const requesterId = req.auth?.userId ?? null;

    await withFileViewLogging(
      req,
      {
        route: "/api/files/:id/view",
        fileId,
        getRequesterId: () => requesterId,
      },
      async (progress) => {
        await assertCanViewFile(req.auth!, fileId);
        const file = await getFileOrThrow(fileId);

        if (!file.fileUrl) {
          throw new HttpError(404, "Stored file missing.");
        }

        const displayName = file.originalName ?? file.filename;
        return streamPreparedStoredFileToResponse(
          res,
          file.fileUrl,
          {
            disposition: "inline",
            filename: displayName,
            contentType: file.mimeType,
            cacheControl: "private, no-store",
            rangeHeader: req.headers.range ?? null,
          },
          progress,
        );
      },
    );
  }),
);

// ---------------------------------------------------------------------------
// File annotations (PDF markup)
// ---------------------------------------------------------------------------

const annotationToolEnum = z.enum(TOOL_TYPES);

const normalizedCoord = z.coerce.number().min(-0.5).max(1.5);
const normalizedSize = z.coerce.number().min(0).max(2);

const pathPointSchema = z.tuple([z.coerce.number(), z.coerce.number()]);

const createAnnotationSchema = z.object({
  page: z.coerce.number().int().min(1),
  toolType: annotationToolEnum,
  color: z.string().trim().min(1).max(50),
  thickness: z.coerce.number().min(0).max(64).optional().nullable(),
  opacity: z.coerce.number().min(0).max(1).optional().nullable(),
  normalizedX: normalizedCoord,
  normalizedY: normalizedCoord,
  normalizedW: normalizedSize.optional().nullable(),
  normalizedH: normalizedSize.optional().nullable(),
  content: z.string().max(2000).optional().nullable(),
  pathData: z.array(pathPointSchema).max(20000).optional().nullable(),
});

router.get(
  "/files/:id/annotations",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    await assertCanViewFile(req.auth!, fileId);

    const annotations = await listAnnotationsForFile(fileId);
    res.json({ annotations });
  }),
);

router.post(
  "/files/:id/annotations",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    // Per spec: anyone with edit access to the file's job can add markup.
    // `assertCanManageFile` enforces folder upload permissions, which is the
    // closest stand-in for "edit access" on file-attached storage.
    await assertCanManageFile(req.auth!, fileId);

    const body = createAnnotationSchema.safeParse(req.body ?? {});
    if (!body.success) {
      throw new HttpError(400, "Invalid annotation payload.", body.error.flatten());
    }

    const annotation = await createAnnotation({
      input: {
        fileId,
        page: body.data.page,
        toolType: body.data.toolType,
        color: body.data.color,
        thickness: body.data.thickness ?? null,
        opacity: body.data.opacity ?? null,
        normalizedX: body.data.normalizedX,
        normalizedY: body.data.normalizedY,
        normalizedW: body.data.normalizedW ?? 0,
        normalizedH: body.data.normalizedH ?? 0,
        content: body.data.content ?? null,
        pathData: body.data.pathData ?? null,
      },
      userId: req.auth!.userId,
    });

    res.status(201).json({ annotation });
  }),
);

const updateAnnotationSchema = z
  .object({
    color: z.string().trim().min(1).max(50).optional(),
    thickness: z.coerce.number().min(0).max(64).optional().nullable(),
    opacity: z.coerce.number().min(0).max(1).optional().nullable(),
    normalizedX: normalizedCoord.optional(),
    normalizedY: normalizedCoord.optional(),
    normalizedW: normalizedSize.optional(),
    normalizedH: normalizedSize.optional(),
    content: z.string().max(2000).optional().nullable(),
    pathData: z.array(pathPointSchema).max(20000).optional().nullable(),
  })
  .refine(
    (val) => Object.values(val).some((v) => v !== undefined),
    { message: "At least one field must be provided." },
  );

router.patch(
  "/files/:id/annotations/:annotationId",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    const annotationId = getParam(req.params.annotationId, "annotation id");

    // Must at least be able to view the file.
    await assertCanViewFile(req.auth!, fileId);

    const existing = await getAnnotationOrThrow(annotationId);
    if (existing.fileId !== fileId) {
      throw new HttpError(404, "Annotation not found.");
    }

    const isCreator = existing.createdBy === req.auth!.userId;
    if (!isCreator && !isAdmin(req.auth!)) {
      throw new HttpError(
        403,
        "Only the markup's author or an admin can edit it.",
      );
    }

    const body = updateAnnotationSchema.safeParse(req.body ?? {});
    if (!body.success) {
      throw new HttpError(400, "Invalid annotation payload.", body.error.flatten());
    }

    const annotation = await updateAnnotation({
      annotationId,
      input: {
        color: body.data.color,
        thickness: body.data.thickness ?? undefined,
        opacity: body.data.opacity ?? undefined,
        normalizedX: body.data.normalizedX,
        normalizedY: body.data.normalizedY,
        normalizedW: body.data.normalizedW,
        normalizedH: body.data.normalizedH,
        content: body.data.content === undefined ? undefined : body.data.content,
        pathData: body.data.pathData === undefined ? undefined : body.data.pathData,
      },
      userId: req.auth!.userId,
    });

    res.json({ annotation });
  }),
);

router.delete(
  "/files/:id/annotations/:annotationId",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    const annotationId = getParam(req.params.annotationId, "annotation id");

    // Must at least be able to view the file.
    await assertCanViewFile(req.auth!, fileId);

    const existing = await getAnnotationOrThrow(annotationId);
    if (existing.fileId !== fileId) {
      throw new HttpError(404, "Annotation not found.");
    }

    const isCreator = existing.createdBy === req.auth!.userId;
    if (!isCreator && !isAdmin(req.auth!)) {
      throw new HttpError(
        403,
        "Only the markup's author or an admin can delete it.",
      );
    }

    await softDeleteAnnotation({
      annotationId,
      userId: req.auth!.userId,
    });

    res.json({ success: true });
  }),
);

router.post(
  "/files/:id/signed-view",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    await assertCanViewFile(req.auth!, fileId);
    await assertActiveUserById(req.auth!.userId);
    const file = await getFileOrThrow(fileId);
    if (!file.fileUrl) {
      throw new HttpError(404, "Stored file missing.");
    }

    const expiresAt = new Date(Date.now() + FILE_VIEW_TOKEN_TTL_SECONDS * 1000).toISOString();
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, req.auth!.userId), eq(users.isActive, true), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      throw new HttpError(401, "Authentication required.");
    }

    const token = signFileViewToken(toPublicUser(user), fileId);

    res.json({
      url: `/api/files/${fileId}/view-signed?token=${encodeURIComponent(token)}`,
      expiresAt,
      expiresIn: FILE_VIEW_TOKEN_TTL_SECONDS,
      delivery: "application",
    });
  }),
);

router.post(
  "/files/:id/signed-download",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    await assertCanViewFile(req.auth!, fileId);
    await assertActiveUserById(req.auth!.userId);
    const file = await getFileOrThrow(fileId);
    if (!file.fileUrl) {
      throw new HttpError(404, "Stored file missing.");
    }

    const expiresAt = new Date(Date.now() + FILE_VIEW_TOKEN_TTL_SECONDS * 1000).toISOString();
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, req.auth!.userId), eq(users.isActive, true), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      throw new HttpError(401, "Authentication required.");
    }

    const token = signFileViewToken(toPublicUser(user), fileId);

    res.json({
      url: `/api/files/${fileId}/download-signed?token=${encodeURIComponent(token)}`,
      expiresAt,
      expiresIn: FILE_VIEW_TOKEN_TTL_SECONDS,
      delivery: "application",
    });
  }),
);

export default router;
