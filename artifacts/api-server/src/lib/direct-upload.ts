import { and, eq, sql } from "drizzle-orm";
import { MAX_UPLOAD_FILE_BYTES, formatUploadSize } from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  files,
  leadAttachments,
  type File,
  type Folder,
} from "@workspace/db/schema";
import {
  signDirectUploadIntent,
  verifyDirectUploadIntent,
  type DirectUploadIntent,
} from "./auth";
import {
  detectFileDuplicate,
  validateUploadForMediaType,
  writeActivity,
} from "./file-manager";
import { HttpError } from "./http";
import { logger } from "./logger";
import { emitRealtimeEvent } from "./realtime";
import {
  buildStoredFileName,
  buildUploadPath,
  createSignedDirectUpload,
  getExactStoredFileSize,
  readStoredFileRange,
} from "./storage";
import { validateMagicBytesForStoredFile } from "./upload-magic-bytes";

type DirectUploadInput = {
  originalName: string;
  mimeType?: string | null;
  totalSize: number;
  contentHash?: string | null;
  note?: string | null;
  videoDurationSeconds?: number | null;
  resumeIntentToken?: string | null;
};

type DirectUploadFolder = Pick<
  Folder,
  | "id"
  | "scope"
  | "jobId"
  | "leadId"
  | "dailyLogId"
  | "scheduleItemId"
  | "mediaType"
  | "viewingPermissions"
  | "uploadingPermissions"
>;

function normalizedHash(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizedDuration(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(Math.round(value), 2_147_483_647);
}

export async function prepareDirectUpload(params: {
  targetType: "folder" | "lead";
  targetId: string;
  folder: DirectUploadFolder;
  userId: string;
  input: DirectUploadInput;
}) {
  const { input, folder } = params;
  if (
    !Number.isSafeInteger(input.totalSize) ||
    input.totalSize <= 0 ||
    input.totalSize > MAX_UPLOAD_FILE_BYTES
  ) {
    throw new HttpError(
      413,
      `${input.originalName} exceeds the ${formatUploadSize(MAX_UPLOAD_FILE_BYTES)} file size limit.`,
      {
        code: "UPLOAD_TOO_LARGE",
        limit: MAX_UPLOAD_FILE_BYTES,
        actual: input.totalSize,
      },
      "payload-too-large",
    );
  }

  const mimeType = input.mimeType?.trim() || "application/octet-stream";
  validateUploadForMediaType(folder.mediaType, {
    originalname: input.originalName,
    mimetype: mimeType,
  });

  const contentHash = normalizedHash(input.contentHash);
  const duplicate = await detectFileDuplicate({
    folderId: folder.id,
    originalName: input.originalName,
    fileSize: input.totalSize,
    contentHash,
  });
  if (input.resumeIntentToken) {
    const resumed = verifyDirectUploadIntent(input.resumeIntentToken);
    assertIntentScope({
      intent: resumed,
      targetType: params.targetType,
      targetId: params.targetId,
      folderId: folder.id,
      userId: params.userId,
    });
    if (
      resumed.originalName !== input.originalName ||
      resumed.mimeType !== mimeType ||
      resumed.totalSize !== input.totalSize
    ) {
      throw new HttpError(
        409,
        "The saved resumable upload does not match the selected file.",
        { code: "DIRECT_UPLOAD_RESUME_MISMATCH" },
        "conflict",
      );
    }
    const storage = await createSignedDirectUpload(resumed.fileUrl);
    logger.info(
      {
        event: "upload.direct.resigned",
        targetType: params.targetType,
        targetId: params.targetId,
        folderId: folder.id,
        userId: params.userId,
        fileUrl: resumed.fileUrl,
        expectedBytes: resumed.totalSize,
      },
      "Re-signed resumable direct upload",
    );
    return {
      status: "ready" as const,
      duplicate,
      intentToken: input.resumeIntentToken,
      storage,
    };
  }
  const storedName = buildStoredFileName(input.originalName);
  const { fileUrl } = buildUploadPath({
    jobId:
      params.targetType === "lead"
        ? `lead-${params.targetId}`
        : folder.jobId ?? "resources",
    mediaType: folder.mediaType,
    storedFileName: storedName,
  });
  const intent: DirectUploadIntent = {
    version: 1,
    targetType: params.targetType,
    targetId: params.targetId,
    folderId: folder.id,
    userId: params.userId,
    fileUrl,
    storedName,
    originalName: input.originalName,
    mimeType,
    totalSize: input.totalSize,
    contentHash,
    note: input.note?.trim() || null,
    duplicateAction: "keep_both",
    videoDurationSeconds: normalizedDuration(input.videoDurationSeconds),
  };

  const [storage, intentToken] = await Promise.all([
    createSignedDirectUpload(fileUrl),
    Promise.resolve(signDirectUploadIntent(intent)),
  ]);
  logger.info(
    {
      event: "upload.direct.prepared",
      targetType: params.targetType,
      targetId: params.targetId,
      folderId: folder.id,
      userId: params.userId,
      fileUrl,
      expectedBytes: input.totalSize,
    },
    "Prepared resumable direct upload",
  );
  return {
    status: "ready" as const,
    duplicate,
    intentToken,
    storage,
  };
}

function assertIntentScope(params: {
  intent: DirectUploadIntent;
  targetType: "folder" | "lead";
  targetId: string;
  folderId: string;
  userId: string;
}) {
  const { intent } = params;
  if (
    intent.targetType !== params.targetType ||
    intent.targetId !== params.targetId ||
    intent.folderId !== params.folderId ||
    intent.userId !== params.userId
  ) {
    throw new HttpError(
      403,
      "This direct-upload intent does not belong to this destination.",
      { code: "DIRECT_UPLOAD_SCOPE_MISMATCH" },
      "forbidden",
    );
  }
}

async function validateCompletedObject(intent: DirectUploadIntent) {
  const actualSize = await getExactStoredFileSize(intent.fileUrl);
  if (actualSize !== intent.totalSize) {
    throw new HttpError(
      409,
      "The resumable upload has not completed with the expected byte count.",
      {
        code: "DIRECT_UPLOAD_SIZE_MISMATCH",
        expectedBytes: intent.totalSize,
        actualBytes: actualSize,
      },
      "conflict",
    );
  }

  await validateMagicBytesForStoredFile({
    originalName: intent.originalName,
    mimeType: intent.mimeType,
    source: {
      size: actualSize,
      label: intent.fileUrl,
      read: (position, byteCount) =>
        readStoredFileRange({
          fileUrl: intent.fileUrl,
          totalSize: actualSize,
          position,
          byteCount,
        }),
    },
  });
}

async function lockDirectUploadPath(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  fileUrl: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${fileUrl}, 0))`,
  );
}

async function findExistingByFileUrl(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  fileUrl: string,
) {
  const [existing] = await tx
    .select()
    .from(files)
    .where(eq(files.fileUrl, fileUrl))
    .limit(1);
  return existing ?? null;
}

function assertExistingIsReplay(existing: File, intent: DirectUploadIntent) {
  if (
    existing.deletedAt ||
    existing.folderId !== intent.folderId ||
    existing.uploadedBy !== intent.userId ||
    existing.originalName !== intent.originalName ||
    existing.fileSize !== intent.totalSize
  ) {
    throw new HttpError(
      409,
      "This direct-upload object has already been finalized in a different state.",
      { code: "DIRECT_UPLOAD_ALREADY_FINALIZED" },
      "conflict",
    );
  }
}

async function recordFolderUploadActivity(params: {
  file: File;
  folder: DirectUploadFolder;
  userId: string;
}) {
  try {
    await writeActivity({
      entityType: "file",
      entityId: params.file.id,
      action: "uploaded",
      userId: params.userId,
      jobId: params.folder.jobId ?? null,
      mediaType: params.folder.mediaType,
      folderId: params.folder.id,
      fileId: params.file.id,
      description: `Uploaded ${params.file.originalName}`,
    });
  } catch (error) {
    logger.error(
      { err: error, fileId: params.file.id },
      "Direct upload committed but activity logging failed",
    );
  }
}

export async function finalizeDirectFolderUpload(params: {
  intentToken: string;
  folder: DirectUploadFolder;
  userId: string;
}) {
  const intent = verifyDirectUploadIntent(params.intentToken);
  assertIntentScope({
    intent,
    targetType: "folder",
    targetId: params.folder.id,
    folderId: params.folder.id,
    userId: params.userId,
  });
  validateUploadForMediaType(params.folder.mediaType, {
    originalname: intent.originalName,
    mimetype: intent.mimeType,
  });
  await validateCompletedObject(intent);

  const result = await db.transaction(async (tx) => {
    await lockDirectUploadPath(tx, intent.fileUrl);
    const existing = await findExistingByFileUrl(tx, intent.fileUrl);
    if (existing) {
      assertExistingIsReplay(existing, intent);
      return { file: existing, created: false };
    }

    const [file] = await tx
      .insert(files)
      .values({
        folderId: intent.folderId,
        filename: intent.storedName,
        originalName: intent.originalName,
        fileUrl: intent.fileUrl,
        fileSize: intent.totalSize,
        contentHash: intent.contentHash,
        mimeType: intent.mimeType,
        note: intent.note,
        uploadedBy: intent.userId,
        durationSeconds: intent.videoDurationSeconds,
      })
      .returning();
    return { file, created: true };
  });

  if (result.created) {
    await recordFolderUploadActivity({
      file: result.file,
      folder: params.folder,
      userId: params.userId,
    });
    emitRealtimeEvent(
      "file:uploaded",
      {
        jobId: params.folder.jobId,
        folderId: params.folder.id,
        fileId: result.file.id,
        mediaType: params.folder.mediaType,
        originalName: result.file.originalName,
      },
      params.folder.jobId,
    );
  }

  logger.info(
    {
      event: "upload.direct.complete",
      targetType: "folder",
      targetId: params.folder.id,
      folderId: params.folder.id,
      userId: params.userId,
      fileId: result.file.id,
      fileUrl: result.file.fileUrl,
      expectedBytes: intent.totalSize,
      actualBytes: result.file.fileSize,
      created: result.created,
    },
    "Completed resumable direct upload",
  );

  return {
    status: "uploaded" as const,
    folder: params.folder,
    files: [result.file],
    uploadResults: [
      {
        originalName: result.file.originalName,
        status: "uploaded" as const,
        fileId: result.file.id,
        duplicate: null,
      },
    ],
  };
}

export async function finalizeDirectLeadUpload(params: {
  intentToken: string;
  leadId: string;
  folder: DirectUploadFolder;
  userId: string;
}) {
  const intent = verifyDirectUploadIntent(params.intentToken);
  assertIntentScope({
    intent,
    targetType: "lead",
    targetId: params.leadId,
    folderId: params.folder.id,
    userId: params.userId,
  });
  validateUploadForMediaType(params.folder.mediaType, {
    originalname: intent.originalName,
    mimetype: intent.mimeType,
  });
  await validateCompletedObject(intent);

  const result = await db.transaction(async (tx) => {
    await lockDirectUploadPath(tx, intent.fileUrl);
    let file = await findExistingByFileUrl(tx, intent.fileUrl);
    let created = false;
    if (file) {
      assertExistingIsReplay(file, intent);
    } else {
      [file] = await tx
        .insert(files)
        .values({
          folderId: intent.folderId,
          filename: intent.storedName,
          originalName: intent.originalName,
          fileUrl: intent.fileUrl,
          fileSize: intent.totalSize,
          contentHash: intent.contentHash,
          mimeType: intent.mimeType,
          uploadedBy: intent.userId,
          durationSeconds: intent.videoDurationSeconds,
        })
        .returning();
      created = true;
    }

    let [attachment] = await tx
      .select()
      .from(leadAttachments)
      .where(
        and(
          eq(leadAttachments.leadId, params.leadId),
          eq(leadAttachments.fileId, file.id),
        ),
      )
      .limit(1);
    if (!attachment) {
      [attachment] = await tx
        .insert(leadAttachments)
        .values({ leadId: params.leadId, fileId: file.id })
        .returning();
    }
    return { file, attachment, created };
  });

  if (result.created) {
    try {
      await writeActivity({
        entityType: "lead",
        entityId: params.leadId,
        action: "attachment_uploaded",
        userId: params.userId,
        jobId: null,
        leadId: params.leadId,
        description: `Uploaded attachment ${result.file.originalName}`,
        extra: {
          fileId: result.file.id,
          attachmentId: result.attachment.id,
        },
      });
    } catch (error) {
      logger.error(
        { err: error, fileId: result.file.id, leadId: params.leadId },
        "Direct lead upload committed but activity logging failed",
      );
    }
  }

  logger.info(
    {
      event: "upload.direct.complete",
      targetType: "lead",
      targetId: params.leadId,
      folderId: params.folder.id,
      userId: params.userId,
      fileId: result.file.id,
      attachmentId: result.attachment.id,
      fileUrl: result.file.fileUrl,
      expectedBytes: intent.totalSize,
      actualBytes: result.file.fileSize,
      created: result.created,
    },
    "Completed resumable direct lead attachment upload",
  );

  return {
    status: "uploaded" as const,
    attachments: [
      {
        id: result.attachment.id,
        fileId: result.file.id,
        originalName: result.file.originalName,
        fileUrl: result.file.fileUrl,
        fileSize: result.file.fileSize,
        mimeType: result.file.mimeType,
        createdAt: result.file.createdAt,
        storageStatus: "ok" as const,
      },
    ],
  };
}
