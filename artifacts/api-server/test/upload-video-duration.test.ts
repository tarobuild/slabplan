import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VIDEO_UPLOAD_EXTENSIONS,
  isVideoUpload,
  probeVideoDuration,
  validateVideoDurationsForFiles,
} from "../src/lib/upload-video-duration.ts";
import { HttpError } from "../src/lib/http.ts";

// The duration cap is shared with the browser via @workspace/api-zod.
// The route-layer wiring (wrapMulter) is exercised by the existing
// magic-byte HTTP tests; here we cover the helper itself, which is
// what gives the gate its bite.

function fakeFile(
  overrides: Partial<Express.Multer.File>,
): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: overrides.originalname ?? "clip.mp4",
    encoding: "7bit",
    mimetype: overrides.mimetype ?? "video/mp4",
    size: overrides.size ?? 1024,
    destination: "/tmp",
    filename: overrides.filename ?? "clip.mp4",
    path: overrides.path ?? "/tmp/clip.mp4",
    stream: undefined as never,
    buffer: undefined as never,
  } as Express.Multer.File;
}

test("rejects a video whose probed duration exceeds the limit", async () => {
  const file = fakeFile({ originalname: "long.mp4", path: "/tmp/long.mp4" });
  await assert.rejects(
    () =>
      validateVideoDurationsForFiles([file], {
        maxDurationSeconds: 120,
        probe: () => Promise.resolve(180),
      }),
    (err) => {
      assert.ok(err instanceof HttpError, "expected an HttpError");
      assert.equal(err.statusCode, 413);
      const details = err.details as { code?: string; durationSeconds?: number } | null;
      assert.equal(details?.code, "UPLOAD_VIDEO_TOO_LONG");
      assert.equal(details?.durationSeconds, 180);
      assert.match(err.message, /long\.mp4/);
      assert.match(err.message, /3m/);
      assert.match(err.message, /2 minutes? or shorter/);
      return true;
    },
  );
});

test("accepts a video at exactly the limit", async () => {
  const file = fakeFile({ originalname: "exact.mp4" });
  await assert.doesNotReject(() =>
    validateVideoDurationsForFiles([file], {
      maxDurationSeconds: 120,
      probe: () => Promise.resolve(120),
    }),
  );
});

test("accepts a video well under the limit", async () => {
  const file = fakeFile({ originalname: "short.webm", mimetype: "video/webm" });
  await assert.doesNotReject(() =>
    validateVideoDurationsForFiles([file], {
      maxDurationSeconds: 120,
      probe: () => Promise.resolve(15),
    }),
  );
});

test("falls through when the probe returns null (unknown duration)", async () => {
  // Mirrors the browser behaviour: if metadata cannot be decoded we
  // accept the upload; the existing 500 MB size cap is the long-term
  // safety net and we never want a flaky probe to dead-end legitimate
  // uploads.
  const file = fakeFile({ originalname: "exotic.mkv", mimetype: "video/x-matroska" });
  await assert.doesNotReject(() =>
    validateVideoDurationsForFiles([file], {
      maxDurationSeconds: 120,
      probe: () => Promise.resolve(null),
    }),
  );
});

test("falls through when the probe throws", async () => {
  const file = fakeFile({ originalname: "broken.mp4" });
  await assert.doesNotReject(() =>
    validateVideoDurationsForFiles([file], {
      maxDurationSeconds: 120,
      probe: () => Promise.reject(new Error("ffprobe boom")),
    }),
  );
});

test("skips non-video files without invoking the probe", async () => {
  let probeCalls = 0;
  const file = fakeFile({
    originalname: "report.pdf",
    mimetype: "application/pdf",
  });
  await validateVideoDurationsForFiles([file], {
    maxDurationSeconds: 120,
    probe: () => {
      probeCalls += 1;
      return Promise.resolve(9999);
    },
  });
  assert.equal(probeCalls, 0);
});

test("detects video by extension when MIME is missing (curl-style upload)", async () => {
  // Non-browser clients often POST videos with `application/octet-stream`
  // or no MIME at all. The duration check still has to fire.
  const file = fakeFile({
    originalname: "drone.mp4",
    mimetype: "application/octet-stream",
  });
  await assert.rejects(
    () =>
      validateVideoDurationsForFiles([file], {
        maxDurationSeconds: 120,
        probe: () => Promise.resolve(300),
      }),
    (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.statusCode, 413);
      return true;
    },
  );
});

test("detects every advertised video extension when MIME is generic", () => {
  for (const extension of VIDEO_UPLOAD_EXTENSIONS) {
    assert.equal(
      isVideoUpload(`clip${extension}`, "application/octet-stream"),
      true,
      `expected ${extension} to be treated as a video`,
    );
  }
});

test("probeVideoDuration returns null when the binary is missing", async () => {
  // Real ffprobe spawn — but pointed at a binary that does not exist
  // on PATH. The probe must resolve to null instead of rejecting, so
  // the upload pipeline falls through cleanly.
  const result = await probeVideoDuration("/tmp/whatever-does-not-exist.mp4", {
    binary: "definitely-not-a-real-binary-asdfqwer",
  });
  assert.equal(result, null);
});

test("probeVideoDuration returns null for a non-video file", async () => {
  // Spawn the real ffprobe (available in the Replit nix env) against
  // this very test file. ffprobe will exit non-zero and we resolve
  // null — proving the helper degrades gracefully on garbage input.
  const url = new URL(import.meta.url);
  const result = await probeVideoDuration(url.pathname);
  assert.equal(result, null);
});
