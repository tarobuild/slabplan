import path from "node:path";
import fs from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import { HttpError } from "./http";
import { logger } from "./logger";

/**
 * Categories of uploaded media that we *must* validate by magic-byte
 * sniffing. Extension + Content-Type alone are trivially spoofable
 * (rename `payload.html` to `photo.jpg`, set MIME to `image/jpeg`, and
 * old code would happily store + serve it). For each category we list
 * the MIME types and extensions a client may legitimately *claim* and
 * the MIME types that the `file-type` sniff is allowed to return for
 * the bytes on disk.
 *
 * Anything outside these categories (docx/xlsx/csv/txt/etc.) is
 * intentionally not magic-byte-validated here — those formats are
 * either zip-based (handled separately by container-level validation
 * upstream) or text formats with no reliable magic bytes. The
 * existing `validateUploadForMediaType` extension/MIME filter still
 * applies to them.
 */
interface SniffableCategory {
  category: string;
  claimedMimes: ReadonlySet<string>;
  claimedExtensions: ReadonlySet<string>;
  sniffedMimes: ReadonlySet<string>;
}

const PDF_CATEGORY: SniffableCategory = {
  category: "PDF",
  claimedMimes: new Set(["application/pdf"]),
  claimedExtensions: new Set([".pdf"]),
  sniffedMimes: new Set(["application/pdf"]),
};

const SNIFFABLE_CATEGORIES: readonly SniffableCategory[] = [
  PDF_CATEGORY,
  {
    category: "JPEG image",
    claimedMimes: new Set(["image/jpeg", "image/jpg", "image/pjpeg"]),
    claimedExtensions: new Set([".jpg", ".jpeg"]),
    sniffedMimes: new Set(["image/jpeg"]),
  },
  {
    category: "PNG image",
    claimedMimes: new Set(["image/png"]),
    claimedExtensions: new Set([".png"]),
    sniffedMimes: new Set(["image/png", "image/apng"]),
  },
  {
    category: "WebP image",
    claimedMimes: new Set(["image/webp"]),
    claimedExtensions: new Set([".webp"]),
    sniffedMimes: new Set(["image/webp"]),
  },
  {
    category: "GIF image",
    claimedMimes: new Set(["image/gif"]),
    claimedExtensions: new Set([".gif"]),
    sniffedMimes: new Set(["image/gif"]),
  },
  {
    category: "MP4 video",
    claimedMimes: new Set(["video/mp4", "video/x-m4v", "application/mp4"]),
    claimedExtensions: new Set([".mp4", ".m4v"]),
    // file-type returns video/mp4 for both mp4 and m4v containers.
    sniffedMimes: new Set(["video/mp4", "video/x-m4v"]),
  },
  {
    category: "WebM video",
    claimedMimes: new Set(["video/webm"]),
    claimedExtensions: new Set([".webm"]),
    sniffedMimes: new Set(["video/webm"]),
  },
  {
    category: "QuickTime video",
    claimedMimes: new Set(["video/quicktime"]),
    claimedExtensions: new Set([".mov", ".qt"]),
    sniffedMimes: new Set(["video/quicktime"]),
  },
];

function findSniffableCategory(
  claimedMime: string,
  extension: string,
): SniffableCategory | null {
  for (const category of SNIFFABLE_CATEGORIES) {
    if (
      category.claimedMimes.has(claimedMime) ||
      category.claimedExtensions.has(extension)
    ) {
      return category;
    }
  }
  return null;
}

interface MismatchOptions {
  detail?: string;
  pdfHeaderOffset?: number | null;
}

function makeMismatchError(
  category: SniffableCategory,
  claimedMime: string,
  extension: string,
  sniffedMime: string | null,
  options: MismatchOptions = {},
): HttpError {
  const declared = claimedMime || "unknown";
  const ext = extension || "none";
  const got = sniffedMime ?? "unrecognized";
  const message =
    options.detail ??
    `Uploaded file does not look like a real ${category.category}. ` +
      `Declared MIME "${declared}" / extension "${ext}", but the file's ` +
      `actual contents sniff as "${got}". Try re-saving the file and uploading again.`;
  return new HttpError(
    415,
    message,
    {
      code: "MAGIC_BYTE_MISMATCH",
      category: category.category,
      declaredMimeType: claimedMime || null,
      extension: extension || null,
      sniffedMimeType: sniffedMime,
      ...(options.pdfHeaderOffset !== undefined
        ? { pdfHeaderOffset: options.pdfHeaderOffset }
        : {}),
    },
    "unsupported-media-type",
  );
}

// Per the PDF spec, the `%PDF-` header may appear within the first 1024
// bytes of the file. Many real PDFs in the wild — particularly those
// that have been re-saved by older Office, scanned, or piped through
// mail systems — have a UTF-8 BOM, blank lines, or a short preamble
// before the header. We must accept these as valid.
const PDF_HEADER_SCAN_BYTES = 1024;
const PDF_HEADER = Buffer.from("%PDF-");

// To recognise password-protected PDFs we look for an `/Encrypt` entry
// in the trailer dictionary. The trailer normally lives near the end
// of the file, but for very small / linearised PDFs it may be near the
// start. Reading both ends keeps us cheap on large PDFs while still
// catching the common cases.
const PDF_ENCRYPT_HEAD_BYTES = 64 * 1024;
const PDF_ENCRYPT_TAIL_BYTES = 16 * 1024;
const PDF_ENCRYPT_TOKEN = Buffer.from("/Encrypt");

interface PdfInspection {
  headerOffset: number;
  encrypted: boolean;
}

async function readBytes(
  filePath: string,
  byteCount: number,
  position = 0,
): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buf, 0, byteCount, position);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function inspectPdf(filePath: string): Promise<PdfInspection | null> {
  // Read 1024 leading bytes plus the marker length so a `%PDF-` that
  // starts exactly at offset 1024 is still matched in full.
  const head = await readBytes(
    filePath,
    PDF_HEADER_SCAN_BYTES + PDF_HEADER.length,
    0,
  );
  const headerOffset = head.indexOf(PDF_HEADER);
  if (headerOffset < 0) return null;

  // Encryption check: scan the head + tail for the `/Encrypt` keyword.
  // Avoid double-reading bytes if the file is small.
  let encrypted = false;
  const headEncryptScan = await readBytes(filePath, PDF_ENCRYPT_HEAD_BYTES, 0);
  if (headEncryptScan.indexOf(PDF_ENCRYPT_TOKEN) >= 0) {
    encrypted = true;
  } else {
    const stat = await fs.stat(filePath);
    if (stat.size > PDF_ENCRYPT_HEAD_BYTES) {
      const tailStart = Math.max(
        PDF_ENCRYPT_HEAD_BYTES,
        stat.size - PDF_ENCRYPT_TAIL_BYTES,
      );
      const tail = await readBytes(
        filePath,
        Math.min(PDF_ENCRYPT_TAIL_BYTES, stat.size - tailStart),
        tailStart,
      );
      if (tail.indexOf(PDF_ENCRYPT_TOKEN) >= 0) {
        encrypted = true;
      }
    }
  }

  return { headerOffset, encrypted };
}

async function validatePdf(
  file: Express.Multer.File,
  claimedMime: string,
  extension: string,
): Promise<void> {
  let inspection: PdfInspection | null;
  try {
    inspection = await inspectPdf(file.path);
  } catch (err) {
    logger.warn(
      { err, path: file.path, originalName: file.originalname },
      "PDF magic-byte read failed; rejecting upload",
    );
    throw new HttpError(
      415,
      "Could not read uploaded file to verify its type. Try re-saving the file and uploading again.",
      { code: "MAGIC_BYTE_SNIFF_FAILED" },
      "unsupported-media-type",
    );
  }

  if (!inspection) {
    throw makeMismatchError(PDF_CATEGORY, claimedMime, extension, null, {
      detail:
        "This file isn't a PDF — please re-export from your editor or pick a different file.",
      pdfHeaderOffset: null,
    });
  }

  if (inspection.encrypted) {
    throw makeMismatchError(PDF_CATEGORY, claimedMime, extension, "application/pdf", {
      detail:
        "This PDF appears to be password-protected. Remove the password and try again.",
      pdfHeaderOffset: inspection.headerOffset,
    });
  }
}

/**
 * Sniff the magic bytes of a multer-saved file and verify that they
 * match the client-claimed MIME / extension. Throws HttpError(415) on
 * mismatch. Files outside the watched categories pass through
 * untouched, so docx / csv / txt uploads are unaffected.
 *
 * Reads the file from disk; `file-type` only consumes the first few
 * KB, so this is cheap even for multi-hundred-MB videos — we never
 * load the whole file into memory.
 */
export async function validateMagicBytesForFile(
  file: Express.Multer.File,
): Promise<void> {
  const claimedMime = (file.mimetype ?? "").toLowerCase();
  const extension = path.extname(file.originalname ?? "").toLowerCase();

  const expected = findSniffableCategory(claimedMime, extension);
  if (!expected) return;

  if (!file.path) {
    // Upload didn't end up on disk (in-memory storage / streamed). The
    // sniffer needs a path; surface this as a server bug rather than a
    // client error so it isn't silently bypassed.
    throw new HttpError(
      500,
      "Upload pipeline misconfigured: cannot sniff in-memory uploads.",
      { code: "MAGIC_BYTE_NO_PATH" },
      "internal-server-error",
    );
  }

  if (expected === PDF_CATEGORY) {
    // PDFs need a tolerant header scan (per the spec, %PDF- may appear
    // anywhere in the first 1024 bytes) so we bypass `file-type`,
    // which only matches at offset 0.
    await validatePdf(file, claimedMime, extension);
    return;
  }

  let sniffed;
  try {
    sniffed = await fileTypeFromFile(file.path);
  } catch (err) {
    logger.warn(
      { err, path: file.path, originalName: file.originalname },
      "Magic-byte sniff failed; rejecting upload",
    );
    throw new HttpError(
      415,
      "Could not read uploaded file to verify its type. Try re-saving the file and uploading again.",
      { code: "MAGIC_BYTE_SNIFF_FAILED" },
      "unsupported-media-type",
    );
  }

  if (!sniffed || !expected.sniffedMimes.has(sniffed.mime)) {
    throw makeMismatchError(
      expected,
      claimedMime,
      extension,
      sniffed?.mime ?? null,
    );
  }
}

/**
 * Validate every file in the request. Stops at the first mismatch
 * (multer's response cleanup will purge all temp files anyway).
 */
export async function validateMagicBytesForFiles(
  files: ReadonlyArray<Express.Multer.File>,
): Promise<void> {
  for (const file of files) {
    await validateMagicBytesForFile(file);
  }
}
