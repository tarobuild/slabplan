import path from "node:path";
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

const SNIFFABLE_CATEGORIES: readonly SniffableCategory[] = [
  {
    category: "PDF",
    claimedMimes: new Set(["application/pdf"]),
    claimedExtensions: new Set([".pdf"]),
    sniffedMimes: new Set(["application/pdf"]),
  },
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

function makeMismatchError(
  category: SniffableCategory,
  claimedMime: string,
  extension: string,
  sniffedMime: string | null,
): HttpError {
  const declared = claimedMime || "unknown";
  const ext = extension || "none";
  const got = sniffedMime ?? "unrecognized";
  return new HttpError(
    415,
    `Uploaded file does not look like a real ${category.category}. ` +
      `Declared MIME "${declared}" / extension "${ext}", but the file's ` +
      `actual contents sniff as "${got}".`,
    {
      code: "MAGIC_BYTE_MISMATCH",
      category: category.category,
      declaredMimeType: claimedMime || null,
      extension: extension || null,
      sniffedMimeType: sniffedMime,
    },
    "unsupported-media-type",
  );
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
      "Could not read uploaded file to verify its type.",
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
