import path from "node:path";
import fs from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import { inflateSync, strFromU8 } from "fflate";
import { HttpError } from "./http";
import { logger } from "./logger";

/**
 * Categories of uploaded media that we *must* validate by magic-byte
 * sniffing. Extension + Content-Type alone are trivially spoofable
 * (rename `payload.html` to `photo.jpg`, set MIME to `image/jpeg`, and
 * old code would happily store + serve it).
 *
 * Coverage:
 *   - PDF: tolerant 8-KB header scan, plus password-protected detection.
 *   - Images: JPEG, PNG, WebP, GIF, HEIC/HEIF, TIFF, BMP — sniffed
 *     against `file-type`'s known signatures.
 *   - SVG: not binary; we accept as text/xml and reject any inline
 *     `<script>` payload before storage.
 *   - Office: DOCX/XLSX/PPTX (zip + `[Content_Types].xml` containing
 *     the expected schema marker), legacy DOC/XLS/PPT (OLE2 magic
 *     `D0CF11E0`).
 *   - Video: MP4 / WebM / QuickTime as before.
 *   - Plain text / data formats (CSV/TSV/TXT/MD/RTF/JSON): no reliable
 *     binary signature; the route-level extension+MIME allowlist is
 *     authoritative for them, and they intentionally pass through this
 *     layer.
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

const SVG_CATEGORY: SniffableCategory = {
  category: "SVG image",
  claimedMimes: new Set(["image/svg+xml", "image/svg"]),
  claimedExtensions: new Set([".svg"]),
  sniffedMimes: new Set(["image/svg+xml", "application/xml", "text/xml"]),
};

const OOXML_CATEGORY: SniffableCategory = {
  category: "Office document",
  // We deliberately do NOT include `application/octet-stream` here:
  // the OOXML check is gated on extension or an explicit Office MIME so
  // generic binary uploads (extensionless or `.bin`) aren't accidentally
  // routed through the zip-sniffing path.
  claimedMimes: new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]),
  claimedExtensions: new Set([".docx", ".xlsx", ".pptx"]),
  // OOXML is a zip on disk; file-type will return application/zip.
  sniffedMimes: new Set([
    "application/zip",
    "application/x-zip",
  ]),
};

const ODF_CATEGORY: SniffableCategory = {
  category: "OpenDocument file",
  claimedMimes: new Set([
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
  ]),
  claimedExtensions: new Set([".odt", ".ods", ".odp"]),
  sniffedMimes: new Set(["application/zip", "application/x-zip"]),
};

const OLE2_CATEGORY: SniffableCategory = {
  category: "Legacy Office document",
  // Same gating as OOXML — extension or explicit legacy-Office MIME only.
  claimedMimes: new Set([
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/x-ole-storage",
  ]),
  claimedExtensions: new Set([".doc", ".xls", ".ppt"]),
  // OLE2 / CFB compound document — file-type variously labels these.
  sniffedMimes: new Set([
    "application/x-cfb",
    "application/vnd.ms-office",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
  ]),
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
    category: "HEIC/HEIF image",
    claimedMimes: new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]),
    claimedExtensions: new Set([".heic", ".heif"]),
    sniffedMimes: new Set([
      "image/heic",
      "image/heif",
      "image/heic-sequence",
      "image/heif-sequence",
    ]),
  },
  {
    category: "TIFF image",
    claimedMimes: new Set(["image/tiff", "image/x-tiff"]),
    claimedExtensions: new Set([".tif", ".tiff"]),
    sniffedMimes: new Set(["image/tiff"]),
  },
  {
    category: "BMP image",
    claimedMimes: new Set(["image/bmp", "image/x-bmp", "image/x-ms-bmp"]),
    claimedExtensions: new Set([".bmp"]),
    sniffedMimes: new Set(["image/bmp"]),
  },
  SVG_CATEGORY,
  OOXML_CATEGORY,
  ODF_CATEGORY,
  OLE2_CATEGORY,
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
  {
    category: "Matroska video",
    claimedMimes: new Set(["video/x-matroska", "video/mkv"]),
    claimedExtensions: new Set([".mkv"]),
    sniffedMimes: new Set(["video/x-matroska", "video/webm"]),
  },
  {
    category: "AVIF image",
    claimedMimes: new Set(["image/avif"]),
    claimedExtensions: new Set([".avif"]),
    sniffedMimes: new Set(["image/avif"]),
  },
  {
    category: "Canon RAW image",
    claimedMimes: new Set(["image/x-canon-cr2", "image/x-canon-cr3"]),
    claimedExtensions: new Set([".cr2", ".cr3"]),
    sniffedMimes: new Set(["image/x-canon-cr2", "image/x-canon-cr3", "image/tiff"]),
  },
  {
    category: "Nikon RAW image",
    claimedMimes: new Set(["image/x-nikon-nef"]),
    claimedExtensions: new Set([".nef"]),
    sniffedMimes: new Set(["image/x-nikon-nef", "image/tiff"]),
  },
  {
    category: "Sony RAW image",
    claimedMimes: new Set(["image/x-sony-arw"]),
    claimedExtensions: new Set([".arw"]),
    sniffedMimes: new Set(["image/x-sony-arw", "image/tiff"]),
  },
  {
    category: "Adobe DNG RAW image",
    claimedMimes: new Set(["image/x-adobe-dng"]),
    claimedExtensions: new Set([".dng"]),
    sniffedMimes: new Set(["image/x-adobe-dng", "image/tiff"]),
  },
  {
    category: "MP3 audio",
    claimedMimes: new Set(["audio/mpeg", "audio/mp3"]),
    claimedExtensions: new Set([".mp3"]),
    sniffedMimes: new Set(["audio/mpeg"]),
  },
  {
    category: "M4A audio",
    claimedMimes: new Set(["audio/mp4", "audio/x-m4a", "audio/m4a"]),
    claimedExtensions: new Set([".m4a"]),
    sniffedMimes: new Set(["audio/mp4", "audio/x-m4a"]),
  },
  {
    category: "WAV audio",
    claimedMimes: new Set(["audio/wav", "audio/x-wav", "audio/wave"]),
    claimedExtensions: new Set([".wav"]),
    sniffedMimes: new Set(["audio/wav", "audio/x-wav"]),
  },
  {
    category: "FLAC audio",
    claimedMimes: new Set(["audio/flac", "audio/x-flac"]),
    claimedExtensions: new Set([".flac"]),
    sniffedMimes: new Set(["audio/x-flac", "audio/flac"]),
  },
  {
    category: "ZIP archive",
    // OOXML/ODF use the same .zip bytes but are matched first via their
    // own categories above (claimedExtensions list .docx/.xlsx/...). A
    // raw `.zip` falls through to here.
    claimedMimes: new Set([
      "application/zip",
      "application/x-zip",
      "application/x-zip-compressed",
    ]),
    claimedExtensions: new Set([".zip"]),
    sniffedMimes: new Set(["application/zip", "application/x-zip"]),
  },
  {
    category: "RAR archive",
    claimedMimes: new Set([
      "application/vnd.rar",
      "application/x-rar",
      "application/x-rar-compressed",
    ]),
    claimedExtensions: new Set([".rar"]),
    sniffedMimes: new Set([
      "application/x-rar-compressed",
      "application/vnd.rar",
    ]),
  },
  {
    category: "7-Zip archive",
    claimedMimes: new Set(["application/x-7z-compressed"]),
    claimedExtensions: new Set([".7z"]),
    sniffedMimes: new Set(["application/x-7z-compressed"]),
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

// Plain-text / data formats have no reliable binary signature, but we
// still must not let a renamed executable through. We scan the first
// 8 KB and reject the upload if it contains a NUL byte or a
// disproportionate number of non-text control bytes — both are strong
// indicators of binary content. RTF is excluded from the scan because
// real RTF starts with `{\rtf` ASCII and stays text-only, so the same
// rule applies cleanly.
const TEXT_DATA_EXTENSIONS: ReadonlySet<string> = new Set([
  ".txt",
  ".csv",
  ".tsv",
  ".md",
  ".json",
  ".rtf",
]);
const TEXT_SCAN_BYTES = 8 * 1024;

function looksLikeBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x00) return true;
    // Allow tab(09), LF(0A), CR(0D), FF(0C); flag other control bytes.
    if (b < 0x09 || (b > 0x0d && b < 0x20)) {
      suspicious++;
    }
  }
  return suspicious / buf.length > 0.05;
}

async function validateTextLike(
  file: Express.Multer.File,
  claimedMime: string,
  extension: string,
): Promise<void> {
  const head = await readBytes(file.path, TEXT_SCAN_BYTES, 0);
  if (looksLikeBinary(head)) {
    throw new HttpError(
      415,
      `Uploaded file looks like a binary, not a "${extension || "text"}" text file. ` +
        "Renaming a binary to a text extension is not allowed.",
      {
        code: "UPLOAD_BINARY_AS_TEXT",
        declaredMimeType: claimedMime || null,
        extension: extension || null,
      },
      "unsupported-media-type",
    );
  }
}

interface MismatchOptions {
  detail?: string;
  pdfHeaderOffset?: number | null;
  errorCode?: string;
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
      code: options.errorCode ?? "MAGIC_BYTE_MISMATCH",
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

// Per the PDF spec, the `%PDF-` header may appear within the first few KB
// of the file. Many real PDFs in the wild — especially ones re-saved by
// older Office, scanned, or piped through mail systems — have a UTF-8
// BOM, blank lines, or a short preamble before the header. Bumping the
// scan window from 1 KB to 8 KB makes us tolerant of those without
// risking accepting non-PDFs.
const PDF_HEADER_SCAN_BYTES = 8 * 1024;
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
  const head = await readBytes(
    filePath,
    PDF_HEADER_SCAN_BYTES + PDF_HEADER.length,
    0,
  );
  const headerOffset = head.indexOf(PDF_HEADER);
  if (headerOffset < 0) return null;

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
      errorCode: "UPLOAD_PDF_ENCRYPTED",
    });
  }
}

// SVG: defensive XML check. SVG is text/XML and `file-type` doesn't
// catch it, but it can carry inline `<script>` and `<foreignObject>`
// HTML which would run when the file is embedded directly. We accept
// only documents whose root element is `<svg>` and reject any inline
// scripts / `javascript:` URLs / event-handler attributes before
// allowing the upload through.
const SVG_SCAN_CHUNK_BYTES = 64 * 1024;
const SVG_PATTERN_OVERLAP_BYTES = 256;
const SVG_FORBIDDEN = [
  /<script\b/i,
  /javascript:/i,
  /\son\w+\s*=/i,
  /<foreignObject\b/i,
];

async function inspectSvg(filePath: string): Promise<{
  hasSvgRoot: boolean;
  unsafe: boolean;
}> {
  const handle = await fs.open(filePath, "r");
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const buffer = Buffer.alloc(SVG_SCAN_CHUNK_BYTES);
  let hasSvgRoot = false;
  let carry = "";

  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }

      const text = carry + decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      hasSvgRoot ||= /<svg\b/i.test(text);
      if (SVG_FORBIDDEN.some((pattern) => pattern.test(text))) {
        return { hasSvgRoot, unsafe: true };
      }
      carry = text.slice(-SVG_PATTERN_OVERLAP_BYTES);
    }

    const finalText = carry + decoder.decode();
    hasSvgRoot ||= /<svg\b/i.test(finalText);
    return {
      hasSvgRoot,
      unsafe: SVG_FORBIDDEN.some((pattern) => pattern.test(finalText)),
    };
  } finally {
    await handle.close();
  }
}

async function validateSvg(
  file: Express.Multer.File,
  claimedMime: string,
  extension: string,
): Promise<void> {
  const inspection = await inspectSvg(file.path);
  if (!inspection.hasSvgRoot) {
    throw makeMismatchError(SVG_CATEGORY, claimedMime, extension, null, {
      detail: "This file isn't an SVG image.",
    });
  }

  if (inspection.unsafe) {
    throw makeMismatchError(SVG_CATEGORY, claimedMime, extension, "image/svg+xml", {
      detail:
        "SVG files with inline scripts, event handlers, or javascript: URLs are not allowed.",
      errorCode: "UPLOAD_SVG_UNSAFE",
    });
  }
}

// OOXML / ODF: bounded zip inspection. We do NOT load the whole archive
// into memory. Instead we read the End-of-Central-Directory (EOCD)
// record from the tail, walk the central directory, locate the named
// entry (`[Content_Types].xml` for OOXML, `mimetype` for ODF), then
// read just that entry's compressed bytes from disk and inflate. This
// works for archives of any size up to the upload limit (500 MB) and
// caps decompressed bytes per entry to MAX_INSPECTED_ENTRY_BYTES so a
// crafted high-ratio zip can't OOM the server.
const ZIP_LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_CDH_SIG = 0x02014b50;
const ZIP_LFH_SIG = 0x04034b50;
const ZIP_EOCD_MAX_SCAN = 65557; // 22 byte EOCD + 65535 max comment
const MAX_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;
const MAX_INSPECTED_ENTRY_BYTES = 1 * 1024 * 1024;
// Per-document-type markers expected inside [Content_Types].xml.
// The generic OPC content-types namespace is intentionally NOT in this
// list — every OPC zip (including ODF, EPUB and other generic packages)
// can carry it, so matching on it alone would let any well-formed OPC
// zip pose as an Office document. We require a per-part Override that
// names the wordprocessingml / spreadsheetml / presentationml MIME
// family and we require it to agree with the claimed extension.
const OOXML_DOCTYPE_MARKERS: ReadonlyArray<{
  marker: string;
  extensions: ReadonlySet<string>;
  doctype: "word" | "excel" | "powerpoint";
}> = [
  {
    marker: "vnd.openxmlformats-officedocument.wordprocessingml",
    extensions: new Set([".docx"]),
    doctype: "word",
  },
  {
    marker: "vnd.openxmlformats-officedocument.spreadsheetml",
    extensions: new Set([".xlsx"]),
    doctype: "excel",
  },
  {
    marker: "vnd.openxmlformats-officedocument.presentationml",
    extensions: new Set([".pptx"]),
    doctype: "powerpoint",
  },
];
const ODF_MIMETYPE_PREFIX = "application/vnd.oasis.opendocument.";

interface CentralDirectoryEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEocd(buf: Buffer): number {
  // Scan backwards for the EOCD signature.
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === ZIP_EOCD_SIG) return i;
  }
  return -1;
}

async function readCentralDirectory(
  filePath: string,
  fileSize: number,
): Promise<CentralDirectoryEntry[] | null> {
  const tailLen = Math.min(ZIP_EOCD_MAX_SCAN, fileSize);
  const tailStart = fileSize - tailLen;
  const tail = await readBytes(filePath, tailLen, tailStart);
  const eocdRel = findEocd(tail);
  if (eocdRel < 0) return null;

  const cdSize = tail.readUInt32LE(eocdRel + 12);
  const cdOffset = tail.readUInt32LE(eocdRel + 16);
  const totalEntries = tail.readUInt16LE(eocdRel + 10);

  if (cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // ZIP64 — skip rich inspection; caller will treat as "unknown".
    return null;
  }
  if (cdSize > MAX_CENTRAL_DIRECTORY_BYTES) return null;
  if (cdOffset + cdSize > fileSize) return null;

  const cd = await readBytes(filePath, cdSize, cdOffset);
  const entries: CentralDirectoryEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && entries.length < totalEntries) {
    if (cd.readUInt32LE(p) !== ZIP_CDH_SIG) return null;
    const method = cd.readUInt16LE(p + 10);
    const compressedSize = cd.readUInt32LE(p + 20);
    const uncompressedSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const lfhOffset = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset: lfhOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readZipEntryBytes(
  filePath: string,
  fileSize: number,
  entry: CentralDirectoryEntry,
): Promise<Uint8Array | null> {
  if (entry.uncompressedSize > MAX_INSPECTED_ENTRY_BYTES) return null;
  if (entry.compressedSize > MAX_INSPECTED_ENTRY_BYTES) return null;
  if (entry.localHeaderOffset + 30 > fileSize) return null;

  const lfh = await readBytes(filePath, 30, entry.localHeaderOffset);
  if (lfh.readUInt32LE(0) !== ZIP_LFH_SIG) return null;
  const lfhNameLen = lfh.readUInt16LE(26);
  const lfhExtraLen = lfh.readUInt16LE(28);
  const dataStart =
    entry.localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
  if (dataStart + entry.compressedSize > fileSize) return null;

  const compressed = await readBytes(filePath, entry.compressedSize, dataStart);
  if (entry.method === 0) {
    return compressed;
  }
  if (entry.method === 8) {
    // Zip entries are raw DEFLATE (no zlib header) — use inflateSync.
    try {
      return inflateSync(compressed);
    } catch (err) {
      logger.warn({ err, path: filePath, entry: entry.name }, "deflate failed");
      return null;
    }
  }
  // Unsupported method (bzip2, lzma, ...) — punt.
  return null;
}

async function readNamedZipEntry(
  filePath: string,
  name: string,
): Promise<{ found: boolean; bytes: Uint8Array | null }> {
  const stat = await fs.stat(filePath);
  const cd = await readCentralDirectory(filePath, stat.size);
  if (!cd) return { found: false, bytes: null };
  const entry = cd.find((e) => e.name === name);
  if (!entry) return { found: false, bytes: null };
  const bytes = await readZipEntryBytes(filePath, stat.size, entry);
  return { found: true, bytes };
}

async function validateOoxml(
  file: Express.Multer.File,
  claimedMime: string,
  extension: string,
): Promise<void> {
  const head = await readBytes(file.path, 4, 0);
  if (head.compare(ZIP_LOCAL_FILE_HEADER) !== 0) {
    throw makeMismatchError(OOXML_CATEGORY, claimedMime, extension, null, {
      detail:
        "This file isn't a valid Office document. Try re-saving from Word/Excel/PowerPoint and uploading again.",
    });
  }
  let result;
  try {
    result = await readNamedZipEntry(file.path, "[Content_Types].xml");
  } catch (err) {
    logger.warn({ err, path: file.path }, "OOXML zip inspection failed");
    throw makeMismatchError(OOXML_CATEGORY, claimedMime, extension, "application/zip", {
      detail:
        "Could not inspect the uploaded Office document. Try re-saving from Word/Excel/PowerPoint and uploading again.",
      errorCode: "MAGIC_BYTE_SNIFF_FAILED",
    });
  }
  if (!result.found) {
    throw makeMismatchError(OOXML_CATEGORY, claimedMime, extension, "application/zip", {
      detail:
        "This looks like a generic .zip archive, not an Office document. Archive uploads are not allowed.",
      errorCode: "UPLOAD_TYPE_NOT_ALLOWED",
    });
  }
  if (!result.bytes) {
    throw makeMismatchError(OOXML_CATEGORY, claimedMime, extension, "application/zip", {
      detail:
        "Could not read the Office document's metadata entry. Try re-saving and uploading again.",
      errorCode: "MAGIC_BYTE_SNIFF_FAILED",
    });
  }
  const xml = strFromU8(result.bytes);
  const matched = OOXML_DOCTYPE_MARKERS.find((d) => xml.includes(d.marker));
  if (!matched) {
    throw makeMismatchError(OOXML_CATEGORY, claimedMime, extension, "application/zip", {
      detail:
        "This file is a zip archive but doesn't contain Office document metadata. Archive uploads are not allowed.",
      errorCode: "UPLOAD_TYPE_NOT_ALLOWED",
    });
  }
  // Cross-check the marker against the claimed extension so a Word
  // document can't be uploaded as `.xlsx` (or vice versa) and so a zip
  // that only has the generic OPC content-types namespace can't slip
  // through under any Office extension.
  if (extension && !matched.extensions.has(extension)) {
    throw makeMismatchError(OOXML_CATEGORY, claimedMime, extension, "application/zip", {
      detail:
        `This file claims to be "${extension}" but its Office document metadata is for a ` +
        `${matched.doctype} document. Re-save it with the correct extension and try again.`,
      errorCode: "UPLOAD_TYPE_MISMATCH",
    });
  }
}

async function validateOdf(
  file: Express.Multer.File,
  claimedMime: string,
  extension: string,
): Promise<void> {
  const head = await readBytes(file.path, 4, 0);
  if (head.compare(ZIP_LOCAL_FILE_HEADER) !== 0) {
    throw makeMismatchError(ODF_CATEGORY, claimedMime, extension, null, {
      detail:
        "This file isn't a valid OpenDocument file. Re-save from LibreOffice/OpenOffice and try again.",
    });
  }
  let result;
  try {
    result = await readNamedZipEntry(file.path, "mimetype");
  } catch (err) {
    logger.warn({ err, path: file.path }, "ODF zip inspection failed");
    throw makeMismatchError(ODF_CATEGORY, claimedMime, extension, "application/zip", {
      detail:
        "Could not inspect the uploaded OpenDocument file. Try re-saving and uploading again.",
      errorCode: "MAGIC_BYTE_SNIFF_FAILED",
    });
  }
  if (!result.found) {
    throw makeMismatchError(ODF_CATEGORY, claimedMime, extension, "application/zip", {
      detail:
        "This looks like a generic .zip archive, not an OpenDocument file. Archive uploads are not allowed.",
      errorCode: "UPLOAD_TYPE_NOT_ALLOWED",
    });
  }
  if (!result.bytes) {
    throw makeMismatchError(ODF_CATEGORY, claimedMime, extension, "application/zip", {
      detail:
        "Could not read the OpenDocument mimetype entry. Try re-saving and uploading again.",
      errorCode: "MAGIC_BYTE_SNIFF_FAILED",
    });
  }
  const mimetype = strFromU8(result.bytes).trim();
  if (!mimetype.startsWith(ODF_MIMETYPE_PREFIX)) {
    throw makeMismatchError(ODF_CATEGORY, claimedMime, extension, "application/zip", {
      detail:
        "This file is a zip archive but doesn't declare an OpenDocument mimetype. Archive uploads are not allowed.",
      errorCode: "UPLOAD_TYPE_NOT_ALLOWED",
    });
  }
}

// OLE2 / Compound File Binary: the legacy DOC/XLS/PPT magic.
const OLE2_MAGIC = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);
async function validateOle2(
  file: Express.Multer.File,
  claimedMime: string,
  extension: string,
): Promise<void> {
  const head = await readBytes(file.path, OLE2_MAGIC.length, 0);
  if (head.indexOf(OLE2_MAGIC) !== 0) {
    throw makeMismatchError(OLE2_CATEGORY, claimedMime, extension, null, {
      detail:
        "This file isn't a valid legacy Office document. Re-save from Word/Excel/PowerPoint and try again.",
    });
  }
}

/**
 * Sniff the magic bytes of a multer-saved file and verify that they
 * match the client-claimed MIME / extension. Throws HttpError(415) on
 * mismatch. Files outside the watched categories pass through
 * untouched, so csv / txt / md / json / rtf / tsv uploads are
 * unaffected.
 */
export async function validateMagicBytesForFile(
  file: Express.Multer.File,
): Promise<void> {
  const claimedMime = (file.mimetype ?? "").toLowerCase();
  const extension = path.extname(file.originalname ?? "").toLowerCase();

  const expected = findSniffableCategory(claimedMime, extension);
  if (!expected) {
    if (TEXT_DATA_EXTENSIONS.has(extension) && file.path) {
      await validateTextLike(file, claimedMime, extension);
    }
    return;
  }

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
    await validatePdf(file, claimedMime, extension);
    return;
  }

  if (expected === SVG_CATEGORY) {
    await validateSvg(file, claimedMime, extension);
    return;
  }

  if (expected === OOXML_CATEGORY) {
    await validateOoxml(file, claimedMime, extension);
    return;
  }

  if (expected === ODF_CATEGORY) {
    await validateOdf(file, claimedMime, extension);
    return;
  }

  if (expected === OLE2_CATEGORY) {
    await validateOle2(file, claimedMime, extension);
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
