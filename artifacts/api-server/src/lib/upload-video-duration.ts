import { spawn } from "node:child_process";
import {
  MAX_VIDEO_DURATION_SECONDS,
  extensionOf,
  formatVideoDuration,
  isVideoUpload,
  videoDurationLimitLabel,
  VIDEO_UPLOAD_EXTENSIONS,
} from "@workspace/api-zod";
import { HttpError } from "./http";
import { logger } from "./logger";

/**
 * Server-side companion to the browser duration check in
 * `artifacts/cadstone/src/lib/uploads.ts`. The client gate gives users
 * instant feedback before a multi-hundred-MB upload starts, but a
 * non-browser client (curl, MCP tool, scripted upload) can still POST a
 * long video and bypass it. We probe the saved temp file with ffprobe
 * after multer + magic-byte validation, before the route handler
 * commits the row, and reject anything over `MAX_VIDEO_DURATION_SECONDS`
 * with a clean 4xx.
 *
 * Like the client, we treat probe failures as "unknown duration" and
 * fall through — the existing 500 MB size cap remains the long-term
 * safety net. We never want a transient ffprobe hiccup to dead-end a
 * legitimate upload.
 */

const FFPROBE_BIN = process.env.FFPROBE_PATH ?? "ffprobe";
const FFPROBE_TIMEOUT_MS = 10_000;
const FFPROBE_MAX_OUTPUT_BYTES = 64 * 1024;

export interface ProbeOptions {
  /** Override which binary is invoked (used by tests). */
  binary?: string;
  /** Override the wallclock timeout for a single probe. */
  timeoutMs?: number;
}

/**
 * Run ffprobe against `filePath` and return the container duration in
 * seconds. Returns `null` if ffprobe isn't installed, fails to parse
 * the file, or doesn't print a finite duration — the caller treats
 * `null` as "unknown" and lets the upload through.
 */
export function probeVideoDuration(
  filePath: string,
  options: ProbeOptions = {},
): Promise<number | null> {
  const binary = options.binary ?? FFPROBE_BIN;
  const timeoutMs = options.timeoutMs ?? FFPROBE_TIMEOUT_MS;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        binary,
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          filePath,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      logger.warn(
        { err, binary, filePath },
        "ffprobe spawn failed; treating duration as unknown",
      );
      resolve(null);
      return;
    }

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      logger.warn(
        { binary, filePath, timeoutMs },
        "ffprobe timed out; treating duration as unknown",
      );
      finish(null);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (truncated) return;
      if (stdout.length + chunk.length > FFPROBE_MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      stdout += chunk.toString("utf8");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length + chunk.length > FFPROBE_MAX_OUTPUT_BYTES) return;
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      logger.warn(
        { err, binary, filePath },
        "ffprobe child errored; treating duration as unknown",
      );
      finish(null);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        logger.warn(
          { binary, filePath, code, stderr: stderr.slice(0, 500) },
          "ffprobe exited non-zero; treating duration as unknown",
        );
        finish(null);
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        finish(null);
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        finish(null);
        return;
      }
      finish(parsed);
    });
  });
}

export interface VideoDurationValidationOptions {
  /** Override the cap (mostly for tests). */
  maxDurationSeconds?: number;
  /** Override the probe (used by tests to stub ffprobe). */
  probe?: (filePath: string) => Promise<number | null>;
}

function makeTooLongError(
  fileName: string,
  duration: number,
  maxSeconds: number,
): HttpError {
  const limit = videoDurationLimitLabel(maxSeconds);
  return new HttpError(
    413,
    `Videos must be ${limit} or shorter. ${fileName} is ${formatVideoDuration(duration)}.`,
    {
      code: "UPLOAD_VIDEO_TOO_LONG",
      maxDurationSeconds: maxSeconds,
      durationSeconds: duration,
      fileName,
    },
    "payload-too-large",
  );
}

/**
 * Validate every video file in the request against the duration cap.
 * Non-video files are skipped. Probe failures (ffprobe missing, file
 * unreadable, codec unsupported) are intentionally non-fatal so a
 * flaky environment never dead-ends a legitimate upload — we log a
 * warning and let the file through, mirroring the client.
 *
 * Stops at the first over-limit file; multer's response cleanup will
 * purge all temp files anyway.
 */
export async function validateVideoDurationsForFiles(
  files: ReadonlyArray<Express.Multer.File>,
  options: VideoDurationValidationOptions = {},
): Promise<void> {
  const maxSeconds = options.maxDurationSeconds ?? MAX_VIDEO_DURATION_SECONDS;
  const probe = options.probe ?? ((filePath: string) => probeVideoDuration(filePath));

  for (const file of files) {
    if (!isVideoUpload(file.originalname || "", file.mimetype)) continue;
    let duration: number | null;
    try {
      duration = await probe(file.path);
    } catch (err) {
      logger.warn(
        { err, path: file.path, name: file.originalname },
        "Video duration probe threw; falling through",
      );
      continue;
    }
    if (duration == null) continue;
    if (duration > maxSeconds) {
      throw makeTooLongError(file.originalname || "video", duration, maxSeconds);
    }
  }
}

// Export the shared extension list under the local name historically
// used by route handlers, in case any caller wants to mirror the gate.
export { VIDEO_UPLOAD_EXTENSIONS, extensionOf, isVideoUpload };
