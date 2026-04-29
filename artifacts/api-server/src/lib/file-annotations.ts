import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  fileAnnotations,
  files,
  folders,
  users,
  type FileAnnotation,
} from "@workspace/db/schema";
import { HttpError } from "./http";
import { writeActivity } from "./file-manager";

export type ToolType = (typeof TOOL_TYPES)[number];
export const TOOL_TYPES = [
  "highlighter",
  "pen",
  "line",
  "arrow",
  "rectangle",
  "ellipse",
  "sticky_note",
  "text_label",
] as const;

export type SerializedAnnotation = {
  id: string;
  fileId: string;
  page: number;
  toolType: ToolType;
  color: string;
  thickness: number;
  opacity: number;
  normalizedX: number;
  normalizedY: number;
  normalizedW: number;
  normalizedH: number;
  content: string | null;
  pathData: Array<[number, number]> | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

function toNumber(value: string | number | null | undefined, fallback = 0): number {
  if (value == null) return fallback;
  if (typeof value === "number") return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializeAnnotation(
  row: FileAnnotation,
  createdByName: string | null,
): SerializedAnnotation {
  return {
    id: row.id,
    fileId: row.fileId,
    page: row.page,
    toolType: row.toolType as ToolType,
    color: row.color,
    thickness: toNumber(row.thickness, 2),
    opacity: toNumber(row.opacity, 1),
    normalizedX: toNumber(row.normalizedX),
    normalizedY: toNumber(row.normalizedY),
    normalizedW: toNumber(row.normalizedW),
    normalizedH: toNumber(row.normalizedH),
    content: row.content,
    pathData: row.pathData,
    createdBy: row.createdBy,
    createdByName,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function listAnnotationsForFile(fileId: string): Promise<SerializedAnnotation[]> {
  const rows = await db
    .select({
      annotation: fileAnnotations,
      createdByName: users.fullName,
    })
    .from(fileAnnotations)
    .leftJoin(users, eq(fileAnnotations.createdBy, users.id))
    .where(
      and(eq(fileAnnotations.fileId, fileId), isNull(fileAnnotations.deletedAt)),
    )
    .orderBy(asc(fileAnnotations.page), asc(fileAnnotations.createdAt));

  return rows.map((row) => serializeAnnotation(row.annotation, row.createdByName));
}

export async function listAnnotationsByIds(ids: string[]): Promise<SerializedAnnotation[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      annotation: fileAnnotations,
      createdByName: users.fullName,
    })
    .from(fileAnnotations)
    .leftJoin(users, eq(fileAnnotations.createdBy, users.id))
    .where(
      and(inArray(fileAnnotations.id, ids), isNull(fileAnnotations.deletedAt)),
    );

  return rows.map((row) => serializeAnnotation(row.annotation, row.createdByName));
}

async function jobIdForFile(fileId: string): Promise<string | null> {
  const [row] = await db
    .select({ jobId: folders.jobId })
    .from(files)
    .leftJoin(folders, eq(files.folderId, folders.id))
    .where(eq(files.id, fileId))
    .limit(1);

  return row?.jobId ?? null;
}

export type CreateAnnotationInput = {
  fileId: string;
  page: number;
  toolType: ToolType;
  color: string;
  thickness?: number | null;
  opacity?: number | null;
  normalizedX: number;
  normalizedY: number;
  normalizedW?: number | null;
  normalizedH?: number | null;
  content?: string | null;
  pathData?: Array<[number, number]> | null;
};

export async function createAnnotation(params: {
  input: CreateAnnotationInput;
  userId: string;
}): Promise<SerializedAnnotation> {
  const { input, userId } = params;

  const [inserted] = await db
    .insert(fileAnnotations)
    .values({
      fileId: input.fileId,
      page: input.page,
      toolType: input.toolType,
      color: input.color,
      thickness: input.thickness != null ? String(input.thickness) : "2",
      opacity: input.opacity != null ? String(input.opacity) : "1",
      normalizedX: String(input.normalizedX),
      normalizedY: String(input.normalizedY),
      normalizedW: String(input.normalizedW ?? 0),
      normalizedH: String(input.normalizedH ?? 0),
      content: input.content ?? null,
      pathData: input.pathData ?? null,
      createdBy: userId,
    })
    .returning();

  const [creator] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const jobId = await jobIdForFile(input.fileId);
  await writeActivity({
    entityType: "file_annotation",
    entityId: inserted.id,
    action: "created",
    userId,
    jobId,
    fileId: input.fileId,
    description: `Added ${describeTool(input.toolType)} markup on page ${input.page}`,
    extra: { toolType: input.toolType, page: input.page },
  });

  return serializeAnnotation(inserted, creator?.fullName ?? null);
}

export async function softDeleteAnnotation(params: {
  annotationId: string;
  userId: string;
}) {
  const [existing] = await db
    .select()
    .from(fileAnnotations)
    .where(
      and(
        eq(fileAnnotations.id, params.annotationId),
        isNull(fileAnnotations.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new HttpError(404, "Annotation not found.");
  }

  await db
    .update(fileAnnotations)
    .set({ deletedAt: new Date() })
    .where(eq(fileAnnotations.id, params.annotationId));

  const jobId = await jobIdForFile(existing.fileId);
  await writeActivity({
    entityType: "file_annotation",
    entityId: existing.id,
    action: "deleted",
    userId: params.userId,
    jobId,
    fileId: existing.fileId,
    description: `Removed ${describeTool(existing.toolType as ToolType)} markup on page ${existing.page}`,
    extra: { toolType: existing.toolType, page: existing.page },
  });

  return existing;
}

function describeTool(tool: ToolType): string {
  switch (tool) {
    case "highlighter":
      return "highlighter";
    case "pen":
      return "freehand";
    case "line":
      return "line";
    case "arrow":
      return "arrow";
    case "rectangle":
      return "rectangle";
    case "ellipse":
      return "ellipse";
    case "sticky_note":
      return "sticky-note";
    case "text_label":
      return "text-label";
    default:
      return tool;
  }
}

export async function getAnnotationOrThrow(annotationId: string) {
  const [row] = await db
    .select()
    .from(fileAnnotations)
    .where(
      and(
        eq(fileAnnotations.id, annotationId),
        isNull(fileAnnotations.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    throw new HttpError(404, "Annotation not found.");
  }

  return row;
}
