import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_COUNT,
  formatUploadSize,
} from "@workspace/api-zod";
import {
  MAX_UPLOAD_FILE_BYTES as BACKEND_MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_COUNT as BACKEND_MAX_UPLOAD_FILE_COUNT,
  ensureTempUploadDir,
  uploadArray,
  uploadSingle,
} from "../src/lib/uploads.ts";
import { HttpError } from "../src/lib/http.ts";
import {
  PROBLEM_TYPE_BASE,
  sendProblem,
  sendUnknownErrorProblem,
} from "../src/lib/problem-json.ts";

let server: Server;
let baseUrl: string;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  await ensureTempUploadDir();

  // Tiny isolated Express app: just enough to exercise the multer
  // middleware + the global problem+json error handler. We deliberately
  // keep this self-contained so it doesn't need the real database.
  const app = express();

  // Single-file route uses a small per-call limit so we can trigger
  // LIMIT_FILE_SIZE without needing 100 MB of test data.
  app.post(
    "/upload-single-tiny",
    uploadSingle("file", { fileSize: 100 }),
    (_req, res) => {
      res.json({ ok: true });
    },
  );

  // Array route at the default (production) limits.
  app.post("/upload-array-default", uploadArray("files", 2), (req, res) => {
    res.json({
      ok: true,
      count: Array.isArray(req.files) ? req.files.length : 0,
    });
  });

  // Array route with a small global `files` cap so we can trigger
  // multer's LIMIT_FILE_COUNT without uploading 20+ files. The global
  // `files: 2` is stricter than `maxCount: 10`, so the *effective*
  // limit (and what the 413 should name) is 2.
  app.post(
    "/upload-array-tiny-count",
    uploadArray("files", 10, { files: 2 }),
    (_req, res) => {
      res.json({ ok: true });
    },
  );

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof HttpError) {
        sendProblem(res, req, err);
        return;
      }
      sendUnknownErrorProblem(res, req, err);
    },
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function bytes(n: number): Uint8Array {
  return new Uint8Array(n);
}

test("backend and shared upload limits stay in sync", () => {
  assert.equal(BACKEND_MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_FILE_BYTES);
  assert.equal(BACKEND_MAX_UPLOAD_FILE_COUNT, MAX_UPLOAD_FILE_COUNT);
});

test("formatUploadSize renders bytes / KB / MB without rounding to 0 MB", () => {
  assert.equal(formatUploadSize(MAX_UPLOAD_FILE_BYTES), "500 MB");
  assert.equal(formatUploadSize(2048), "2 KB");
  assert.equal(formatUploadSize(100), "100 B");
  assert.equal(formatUploadSize(0), "0 B");
});

test("under-limit upload succeeds", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes(50)], { type: "application/octet-stream" }),
    "small.bin",
  );

  const response = await fetch(`${baseUrl}/upload-single-tiny`, {
    method: "POST",
    body: form,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("oversize file returns 413 problem+json with limit named", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes(500)], { type: "application/octet-stream" }),
    "too-big.bin",
  );

  const response = await fetch(`${baseUrl}/upload-single-tiny`, {
    method: "POST",
    body: form,
  });

  assert.equal(response.status, 413);
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/problem\+json/,
  );

  const body = (await response.json()) as {
    type: string;
    title: string;
    status: number;
    detail: string;
    message: string;
    errors?: { limit?: number; code?: string };
  };

  assert.equal(body.status, 413);
  assert.equal(body.title, "Payload Too Large");
  assert.equal(body.type, `${PROBLEM_TYPE_BASE}/payload-too-large`);
  assert.equal(body.errors?.limit, 100);
  assert.equal(body.errors?.code, "UPLOAD_TOO_LARGE");
  assert.equal(body.errors?.multerCode, "LIMIT_FILE_SIZE");
  // The detail must name the actual byte limit so users see the real cap,
  // not a stale value baked into the client. formatUploadSize is the same
  // helper the frontend picker uses, so messages stay aligned.
  assert.equal(formatUploadSize(100), "100 B");
  assert.ok(
    body.detail.includes("100 B"),
    `detail should name the 100 B limit, got: ${body.detail}`,
  );
});

test("too many files returns 413 problem+json", async () => {
  const form = new FormData();
  for (let i = 0; i < 5; i += 1) {
    form.append(
      "files",
      new Blob([bytes(10)], { type: "application/octet-stream" }),
      `f${i}.bin`,
    );
  }

  const response = await fetch(`${baseUrl}/upload-array-tiny-count`, {
    method: "POST",
    body: form,
  });

  assert.equal(response.status, 413);
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/problem\+json/,
  );

  const body = (await response.json()) as {
    type: string;
    status: number;
    detail: string;
    errors?: { code?: string; limit?: number };
  };

  assert.equal(body.status, 413);
  assert.equal(body.type, `${PROBLEM_TYPE_BASE}/payload-too-large`);
  assert.equal(body.errors?.code, "UPLOAD_TOO_MANY_FILES");
  assert.equal(body.errors?.multerCode, "LIMIT_FILE_COUNT");
  // The effective cap is min(maxCount=10, options.files=2) = 2, so the
  // 413 must name 2, not 10. This guards against the previous bug where
  // the error mapper reported the looser per-field maxCount.
  assert.equal(body.errors?.limit, 2);
  assert.match(body.detail, /limit is 2/);
});

test("extra files in the named field return 400 (LIMIT_UNEXPECTED_FILE)", async () => {
  const form = new FormData();
  for (let i = 0; i < 4; i += 1) {
    form.append(
      "files",
      new Blob([bytes(10)], { type: "application/octet-stream" }),
      `f${i}.bin`,
    );
  }

  // /upload-array-default caps the "files" field at maxCount=2; multer
  // surfaces the extras as LIMIT_UNEXPECTED_FILE, which is a client
  // contract error (400), not a payload-size error (413).
  const response = await fetch(`${baseUrl}/upload-array-default`, {
    method: "POST",
    body: form,
  });

  assert.equal(response.status, 400);
  const body = (await response.json()) as {
    status: number;
    errors?: { code?: string };
  };
  assert.equal(body.errors?.code, "LIMIT_UNEXPECTED_FILE");
});

test("unexpected file field returns 400 (not 413)", async () => {
  const form = new FormData();
  form.append(
    "wrong-field",
    new Blob([bytes(10)], { type: "application/octet-stream" }),
    "x.bin",
  );

  const response = await fetch(`${baseUrl}/upload-single-tiny`, {
    method: "POST",
    body: form,
  });

  assert.equal(response.status, 400);
  const body = (await response.json()) as {
    status: number;
    type: string;
    errors?: { code?: string };
  };
  assert.equal(body.status, 400);
  assert.equal(body.errors?.code, "LIMIT_UNEXPECTED_FILE");
});
