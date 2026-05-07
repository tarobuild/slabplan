/**
 * Upload size and count limits shared between the API server and any clients
 * that talk to it. Both the frontend file picker and the backend multer
 * middleware MUST read these values so the two cannot drift out of sync —
 * historically the frontend let users pick a 200 MB file that the server
 * then rejected at 100 MB, surfacing a generic 500 instead of a clean 413.
 *
 * Out of scope here: changing the actual ceiling. If the limit needs to
 * grow, change the value once below.
 */
export const MAX_UPLOAD_FILE_BYTES = 1024 * 1024 * 500;

/** Maximum number of files allowed in a single multipart request. */
export const MAX_UPLOAD_FILE_COUNT = 20;

/**
 * Maximum allowed duration of an uploaded video, in seconds. Both the
 * browser-side picker AND the API server enforce this — the client check
 * gives users instant feedback before a multi-hundred-MB upload starts,
 * and the server check (ffprobe on the saved temp file) closes the gap
 * for non-browser clients or anyone who bypasses the picker.
 */
export const MAX_VIDEO_DURATION_SECONDS = 120;

/**
 * File extensions we treat as video for the duration check. The list is
 * intentionally narrow — it mirrors the formats ffprobe / browsers can
 * decode reliably. Unknown video containers fall through (probe returns
 * null) on both sides of the wire.
 */
export const VIDEO_UPLOAD_EXTENSIONS: readonly string[] = [
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".m4v",
  ".mkv",
];

/** True when the given filename's extension or MIME indicates a video. */
export function isVideoUpload(fileName: string, mimeType?: string | null): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  return VIDEO_UPLOAD_EXTENSIONS.includes(extensionOf(fileName));
}

/**
 * Format a duration in seconds as a friendly "Xm Ys" / "Ys" string for
 * end-user error messages. We deliberately avoid colon-separated times
 * here because "0:07" reads ambiguously without context.
 */
export function formatVideoDuration(seconds: number): string {
  const safe = Math.max(0, seconds);
  const totalSeconds = Math.round(safe);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes === 0) return `${remainder}s`;
  if (remainder === 0) return `${minutes}m`;
  return `${minutes}m ${remainder}s`;
}

/** Friendly "2 minutes" / "30 seconds" label for the duration cap. */
export function videoDurationLimitLabel(maxSeconds: number = MAX_VIDEO_DURATION_SECONDS): string {
  if (maxSeconds % 60 === 0) {
    const minutes = maxSeconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${maxSeconds} seconds`;
}

/**
 * Human-friendly rendering of a byte limit (e.g. "100 MB", "256 KB",
 * "500 B"). Used in user-facing error messages on both sides of the wire.
 *
 * We deliberately drop to KB / B for sub-MB values so messages stay
 * unambiguous when callers configure smaller per-route limits — rounding
 * everything to MB used to render "0 MB" for those cases.
 */
export function formatUploadSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} B`;
  const MB = 1024 * 1024;
  const KB = 1024;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} B`;
}

/**
 * Dangerous file extensions we refuse to accept anywhere in the app,
 * regardless of which form the upload came from. Everything not on this
 * blocklist is accepted (subject to the magic-byte sniffer for the
 * subset of formats we can verify by content).
 *
 * Categories:
 *   - Windows executables / installers
 *   - Mac/Linux executables and scripts
 *   - Java/Android packages
 *   - HTML/web files that could execute in a browser session
 *
 * Archive bundles (.zip, .rar, ...) are NOT on this list — users in
 * the field routinely send ZIPs of plans / drawings / CAD exports.
 * Inspecting the contents of an archive is explicitly out of scope.
 */
export const DANGEROUS_UPLOAD_EXTENSIONS: ReadonlySet<string> = new Set([
  // Windows
  ".exe",
  ".msi",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".dll",
  // Mac / Linux executables and shell scripts
  ".app",
  ".dmg",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".vbs",
  ".js",
  ".jse",
  ".wsf",
  ".hta",
  // Java / Android packages
  ".jar",
  ".apk",
  // HTML / web files that could execute in a browser session.
  // (Inside an archive is fine — we don't crack archives open.)
  ".html",
  ".htm",
  ".xhtml",
  ".mhtml",
]);

/**
 * Wide, OS-picker-friendly accept list. This is what every upload form's
 * `<input type="file" accept="...">` attribute should advertise. The
 * authoritative gate is the server-side blocklist + magic-byte sniffer,
 * but the picker default still gives users a useful filter so they don't
 * have to switch the OS dropdown to "All files" to attach a HEIC photo
 * or a DWG drawing.
 */
export const WIDE_UPLOAD_ACCEPT_EXTENSIONS: readonly string[] = [
  // Images
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".tif", ".tiff",
  ".bmp", ".svg", ".avif", ".ico",
  // RAW image containers
  ".cr2", ".nef", ".arw", ".dng", ".orf", ".rw2",
  // Video
  ".mp4", ".mov", ".avi", ".webm", ".m4v", ".mkv", ".wmv", ".flv", ".3gp",
  // Audio (incl. iPhone voice memos)
  ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".wma", ".amr",
  // Documents
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".odt", ".ods", ".odp", ".rtf", ".txt", ".md", ".csv", ".tsv",
  ".json", ".xml", ".yaml", ".yml",
  // Apple iWork
  ".pages", ".numbers", ".key",
  // CAD & design
  ".dwg", ".dxf", ".dwf", ".skp", ".rvt", ".rfa", ".ifc",
  ".step", ".stp", ".iges", ".igs", ".stl", ".3ds", ".obj", ".fbx", ".blend",
  ".ai", ".eps", ".psd", ".indd",
  // Archives
  ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz",
  // Email & contacts
  ".eml", ".msg", ".vcf", ".ics",
];

/** Lower-cases the trailing `.ext` of a filename, or returns "" if none. */
export function extensionOf(fileName: string): string {
  if (!fileName) return "";
  const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
  const base = slash >= 0 ? fileName.slice(slash + 1) : fileName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

/** True when the given filename's extension is on the dangerous blocklist. */
export function isDangerousUploadFileName(fileName: string): boolean {
  return DANGEROUS_UPLOAD_EXTENSIONS.has(extensionOf(fileName));
}

/**
 * Human-friendly rejection message for a file blocked by the dangerous
 * extensions list. Names the offending extension and gives a one-line
 * tip so the user can self-recover by zipping the file.
 */
export function dangerousUploadMessage(fileName: string): string {
  const ext = extensionOf(fileName) || "(unknown)";
  return `${ext} files aren't allowed for safety. If you need to share an installer or web file, please put it in a ZIP and try again.`;
}

/**
 * Pre-built `accept` attribute string for `<input type="file">`. Lists
 * every extension the OS picker should show as default-selectable.
 */
export const WIDE_UPLOAD_ACCEPT_ATTRIBUTE = WIDE_UPLOAD_ACCEPT_EXTENSIONS.join(",");
