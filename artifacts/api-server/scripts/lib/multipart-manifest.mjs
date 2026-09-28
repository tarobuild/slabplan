/**
 * Recognize SlabPlan's legacy multipart upload manifests exactly as the
 * application's read path does (see resolveSupabaseObjectRead and
 * assertSupabaseMultipartManifestForFile in src/lib/storage.ts), so backups
 * and recovery drills can verify that every part a file needs was captured.
 *
 * A stored object is served as a multipart manifest when its content type is
 * the manifest type, or when it is at most 1 MiB, starts with "{" and parses
 * as a valid manifest for its own file URL. Parts must sit at
 * `<fileUrl>.parts/NNNNNN`, so a manifest cannot reference another path or
 * another tenant's prefix. test/file-backup.test.ts pins these constants to
 * storage.ts so the two cannot drift silently.
 */
import { Transform } from "node:stream";

export const MULTIPART_MANIFEST_CONTENT_TYPE = "application/vnd.cadstone.multipart-upload+json; charset=utf-8";
export const MULTIPART_MANIFEST_VERSION = 1;
export const MULTIPART_MANIFEST_KIND = "cadstone-supabase-multipart";
export const MULTIPART_MANIFEST_PROBE_MAX_BYTES = 1024 * 1024;
// The application reads a declared manifest in full; bound what a backup buffers.
export const MULTIPART_DECLARED_MANIFEST_MAX_BYTES = 64 * 1024 * 1024;
const UPLOADS_OBJECT_PREFIX = "slabplan/uploads/";

export function bareContentType(value) {
  return String(value ?? "").split(";")[0].trim().toLowerCase();
}

export function isMultipartManifestContentType(value) {
  return bareContentType(value) === bareContentType(MULTIPART_MANIFEST_CONTENT_TYPE);
}

/** `slabplan/uploads/<rel>` -> `/uploads/<rel>`, or null for other objects. */
export function uploadFileUrlForObject(objectName) {
  if (typeof objectName !== "string" || !objectName.startsWith(UPLOADS_OBJECT_PREFIX)) return null;
  const relative = objectName.slice(UPLOADS_OBJECT_PREFIX.length);
  if (!relative || relative.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return `/uploads/${relative}`;
}

export function objectNameForUploadFileUrl(fileUrl) {
  return `slabplan${fileUrl}`;
}

export function multipartPartFileUrl(fileUrl, index) {
  return `${fileUrl}.parts/${String(index).padStart(6, "0")}`;
}

/** Mirror of assertSupabaseMultipartManifestForFile; throws when invalid. */
export function parseMultipartManifestForFile(fileUrl, value) {
  if (!value || typeof value !== "object") throw new Error("Stored multipart manifest is invalid.");
  const { totalBytes, contentType, parts } = value;
  if (
    value.version !== MULTIPART_MANIFEST_VERSION ||
    value.kind !== MULTIPART_MANIFEST_KIND ||
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < 0 ||
    typeof contentType !== "string" ||
    !Array.isArray(parts) ||
    parts.length === 0
  ) {
    throw new Error("Stored multipart manifest is invalid.");
  }
  let totalSize = 0;
  for (const [index, part] of parts.entries()) {
    if (
      !part ||
      typeof part !== "object" ||
      part.index !== index ||
      part.fileUrl !== multipartPartFileUrl(fileUrl, index) ||
      !Number.isSafeInteger(part.size) ||
      part.size <= 0
    ) {
      throw new Error("Stored multipart manifest contains an invalid part.");
    }
    totalSize += part.size;
  }
  if (totalSize !== totalBytes) throw new Error("Stored multipart manifest size does not match its parts.");
  return { totalBytes, contentType, parts: parts.map((part) => ({ index: part.index, fileUrl: part.fileUrl, size: part.size })) };
}

function firstNonWhitespaceByte(buffer) {
  for (const byte of buffer) {
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return byte;
  }
  return null;
}

/**
 * Pass-through that keeps a bounded copy of an object that might be a
 * manifest: declared manifests up to 64 MiB, undeclared bodies up to the
 * application's 1 MiB probe limit and only when they start with "{".
 */
export function createManifestCapture({ declared }) {
  const limit = declared ? MULTIPART_DECLARED_MANIFEST_MAX_BYTES : MULTIPART_MANIFEST_PROBE_MAX_BYTES;
  const result = { captured: null, overflow: false };
  let chunks = [];
  let length = 0;
  let decided = declared;
  let capturing = declared;
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      if (!decided) {
        const first = firstNonWhitespaceByte(chunk);
        if (first !== null) {
          decided = true;
          capturing = first === 0x7b;
        } else {
          chunks.push(chunk);
          length += chunk.length;
        }
      }
      if (capturing) {
        if (length + chunk.length > limit) {
          capturing = false;
          result.overflow = true;
          chunks = [];
        } else {
          chunks.push(chunk);
          length += chunk.length;
        }
      } else if (decided) {
        chunks = [];
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (capturing) result.captured = Buffer.concat(chunks);
      callback();
    },
  });
  return { stream, result };
}

/**
 * Classify one backed-up object the way the application would serve it.
 * Returns { kind: "native" }, { kind: "multipart", manifest } or
 * { kind: "invalid", reason } for a declared manifest that cannot be read.
 */
export function classifyStoredObject({ objectName, contentType, capture }) {
  const fileUrl = uploadFileUrlForObject(objectName);
  if (!fileUrl) return { kind: "native" };
  const declared = isMultipartManifestContentType(contentType);
  if (declared) {
    if (!capture?.captured) return { kind: "invalid", reason: "Declared multipart manifest exceeds the backup's validation limit." };
    try {
      return { kind: "multipart", manifest: parseMultipartManifestForFile(fileUrl, JSON.parse(capture.captured.toString("utf8"))) };
    } catch (error) {
      return { kind: "invalid", reason: `Declared multipart manifest is unreadable: ${error.message}` };
    }
  }
  if (!capture?.captured || capture.captured.length > MULTIPART_MANIFEST_PROBE_MAX_BYTES) return { kind: "native" };
  try {
    return { kind: "multipart", manifest: parseMultipartManifestForFile(fileUrl, JSON.parse(capture.captured.toString("utf8"))) };
  } catch {
    return { kind: "native" };
  }
}

/** Compact manifest-entry form: object names and sizes of every part. */
export function multipartSummary(manifest) {
  return {
    totalBytes: manifest.totalBytes,
    parts: manifest.parts.map((part) => ({ name: objectNameForUploadFileUrl(part.fileUrl), size: part.size })),
  };
}

/**
 * Closure problems for entries recorded as multipart: every part must be in
 * the same run with the recorded size, and the part sizes must add up.
 */
export function multipartClosureProblems(entries) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const problems = [];
  for (const entry of entries) {
    if (!entry.multipart) continue;
    let total = 0;
    entry.multipart.parts.forEach((part, index) => {
      total += part.size;
      const expected = objectNameForUploadFileUrl(multipartPartFileUrl(uploadFileUrlForObject(entry.name) ?? "", index));
      const found = byName.get(part.name);
      if (part.name !== expected) problems.push({ entry, reason: `multipart part ${index} has an unexpected path` });
      else if (!found) problems.push({ entry, reason: `multipart part ${index} is missing from this backup run` });
      else if (found.size !== part.size) problems.push({ entry, reason: `multipart part ${index} is ${found.size} bytes, manifest says ${part.size}` });
      else if (found.organizationId !== entry.organizationId) problems.push({ entry, reason: `multipart part ${index} belongs to another organization` });
    });
    if (total !== entry.multipart.totalBytes) problems.push({ entry, reason: "multipart part sizes do not add up to the file size" });
  }
  return problems;
}
