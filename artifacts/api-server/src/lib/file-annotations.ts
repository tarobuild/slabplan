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

async function listAnnotationsByIds(ids: string[]): Promise<SerializedAnnotation[]> {
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

async function organizationIdForFile(fileId: string): Promise<string> {
  const [row] = await db
    .select({ organizationId: files.organizationId })
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1);

  if (!row?.organizationId) {
    throw new HttpError(404, "File not found.", undefined, "not-found");
  }

  return row.organizationId;
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
      organizationId: await organizationIdForFile(input.fileId),
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

export type UpdateAnnotationInput = {
  color?: string;
  thickness?: number | null;
  opacity?: number | null;
  normalizedX?: number;
  normalizedY?: number;
  normalizedW?: number;
  normalizedH?: number;
  content?: string | null;
  pathData?: Array<[number, number]> | null;
};

export async function updateAnnotation(params: {
  annotationId: string;
  input: UpdateAnnotationInput;
  userId: string;
}): Promise<SerializedAnnotation> {
  const { annotationId, input, userId } = params;

  const [existing] = await db
    .select()
    .from(fileAnnotations)
    .where(
      and(
        eq(fileAnnotations.id, annotationId),
        isNull(fileAnnotations.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new HttpError(404, "Annotation not found.");
  }

  const patch: Partial<typeof fileAnnotations.$inferInsert> = {};
  const changed: string[] = [];

  if (input.color !== undefined && input.color !== existing.color) {
    patch.color = input.color;
    changed.push("color");
  }
  if (input.thickness !== undefined && input.thickness !== null) {
    const next = String(input.thickness);
    if (next !== existing.thickness) {
      patch.thickness = next;
      changed.push("thickness");
    }
  }
  if (input.opacity !== undefined && input.opacity !== null) {
    const next = String(input.opacity);
    if (next !== existing.opacity) {
      patch.opacity = next;
      changed.push("opacity");
    }
  }
  if (input.normalizedX !== undefined) {
    const next = String(input.normalizedX);
    if (next !== existing.normalizedX) {
      patch.normalizedX = next;
      changed.push("position");
    }
  }
  if (input.normalizedY !== undefined) {
    const next = String(input.normalizedY);
    if (next !== existing.normalizedY) {
      patch.normalizedY = next;
      if (!changed.includes("position")) changed.push("position");
    }
  }
  if (input.normalizedW !== undefined) {
    const next = String(input.normalizedW);
    if (next !== existing.normalizedW) {
      patch.normalizedW = next;
      changed.push("size");
    }
  }
  if (input.normalizedH !== undefined) {
    const next = String(input.normalizedH);
    if (next !== existing.normalizedH) {
      patch.normalizedH = next;
      if (!changed.includes("size")) changed.push("size");
    }
  }
  if (input.content !== undefined && input.content !== existing.content) {
    patch.content = input.content;
    changed.push("content");
  }
  if (input.pathData !== undefined) {
    // Compare via JSON.stringify; pathData is a json column.
    const a = JSON.stringify(existing.pathData ?? null);
    const b = JSON.stringify(input.pathData ?? null);
    if (a !== b) {
      patch.pathData = input.pathData ?? null;
      changed.push("path");
    }
  }

  if (Object.keys(patch).length === 0) {
    // Nothing to update — return current row as-is.
    const [creator] = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, existing.createdBy ?? userId))
      .limit(1);
    return serializeAnnotation(existing, creator?.fullName ?? null);
  }

  const [updated] = await db
    .update(fileAnnotations)
    .set(patch)
    .where(eq(fileAnnotations.id, annotationId))
    .returning();

  const [creator] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, updated.createdBy ?? userId))
    .limit(1);

  const jobId = await jobIdForFile(updated.fileId);
  await writeActivity({
    entityType: "file_annotation",
    entityId: updated.id,
    action: "edited",
    userId,
    jobId,
    fileId: updated.fileId,
    description: `Edited ${describeTool(updated.toolType as ToolType)} markup on page ${updated.page}`,
    extra: {
      toolType: updated.toolType,
      page: updated.page,
      changed,
    },
  });

  return serializeAnnotation(updated, creator?.fullName ?? null);
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
