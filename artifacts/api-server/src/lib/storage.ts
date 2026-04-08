import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const uploadRoot = path.resolve(process.cwd(), "uploads");

function normalizeFileComponent(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export async function ensureUploadRoot() {
  await fs.mkdir(uploadRoot, { recursive: true });
}

export function buildStoredFileName(originalName: string) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const normalizedBase = normalizeFileComponent(base) || "file";
  const normalizedExt = normalizeFileComponent(ext) || ext.toLowerCase();

  return `${Date.now()}-${crypto.randomUUID()}-${normalizedBase}${normalizedExt}`;
}

export function buildUploadPath(params: {
  jobId: string;
  mediaType: string;
  storedFileName: string;
}) {
  const relative = path.posix.join(params.jobId, params.mediaType, params.storedFileName);
  return {
    absolute: path.join(uploadRoot, relative),
    relative,
    fileUrl: `/uploads/${relative}`,
  };
}

export function resolveAbsolutePathFromFileUrl(fileUrl: string) {
  const relative = fileUrl.replace(/^\/+uploads\/?/, "");
  const absolute = path.resolve(uploadRoot, relative);
  const normalizedRoot = `${uploadRoot}${path.sep}`;

  if (absolute !== uploadRoot && !absolute.startsWith(normalizedRoot)) {
    throw new Error("Upload path resolves outside of the upload root.");
  }

  return absolute;
}

export async function writeUploadedBuffer(fileUrl: string, buffer: Buffer) {
  const absolutePath = resolveAbsolutePathFromFileUrl(fileUrl);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);
}

export async function deletePhysicalFile(fileUrl: string | null | undefined) {
  if (!fileUrl) {
    return;
  }

  const absolutePath = resolveAbsolutePathFromFileUrl(fileUrl);
  await fs.rm(absolutePath, { force: true });
}
