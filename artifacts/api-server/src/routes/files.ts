import { z } from "zod";
import { Router, type IRouter } from "express";
import {
  assertCanManageFile,
  assertCanUploadToFolder,
  assertCanViewFile,
  assertCanViewFolder,
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
import { getFileOrThrow, listFilesForFolder, moveFile, purgeFile, renameFile, restoreFile, saveUploadedFiles, softDeleteFile } from "../lib/file-manager";
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
import { streamStoredFileToResponse } from "../lib/storage";
import { uploadArray } from "../lib/uploads";
import { createUploadPerUserRateLimit } from "../lib/rate-limit";
import { assertActiveUserById } from "../lib/active-user";

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
  includeDeleted: z.coerce.boolean().optional().default(false),
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

router.post(
  "/folders/:id/files",
  uploadRateLimit,
  uploadArray("files", 20),
  asyncHandler(async (req, res) => {
    const folderId = getParam(req.params.id, "folder id");
    const folder = await assertCanUploadToFolder(req.auth!, folderId);
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
      videoDurationsSeconds: body.data.videoDurations ?? null,
    });

    res.status(201).json(result);
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

    await streamStoredFileToResponse(res, file.fileUrl, {
      disposition: "attachment",
      filename: sanitizeDownloadFilename(file.originalName),
      contentType: file.mimeType,
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
        return streamStoredFileToResponse(
          res,
          file.fileUrl,
          {
            disposition: "inline",
            filename: displayName,
            contentType: file.mimeType,
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
        return streamStoredFileToResponse(
          res,
          file.fileUrl,
          {
            disposition: "inline",
            filename: displayName,
            contentType: file.mimeType,
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

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, req.auth!.userId), eq(users.isActive, true), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      throw new HttpError(401, "Authentication required.");
    }

    const token = signFileViewToken(toPublicUser(user), fileId);
    const expiresAt = new Date(Date.now() + FILE_VIEW_TOKEN_TTL_SECONDS * 1000).toISOString();

    res.json({
      url: `/api/files/${fileId}/view-signed?token=${encodeURIComponent(token)}`,
      expiresAt,
      expiresIn: FILE_VIEW_TOKEN_TTL_SECONDS,
    });
  }),
);

export default router;
