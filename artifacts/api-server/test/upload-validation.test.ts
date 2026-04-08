import assert from "node:assert/strict";
import { test } from "node:test";
import { validateUploadForMediaType } from "../src/lib/file-manager.ts";
import { HttpError } from "../src/lib/http.ts";

test("document uploads reject executable html", () => {
  assert.throws(
    () =>
      validateUploadForMediaType("document", {
        originalname: "payload.html",
        mimetype: "text/html",
      }),
    (error) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("photo uploads reject svg", () => {
  assert.throws(
    () =>
      validateUploadForMediaType("photo", {
        originalname: "payload.svg",
        mimetype: "image/svg+xml",
      }),
    (error) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("document uploads still allow office and text files", () => {
  assert.doesNotThrow(() =>
    validateUploadForMediaType("document", {
      originalname: "report.docx",
      mimetype:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );

  assert.doesNotThrow(() =>
    validateUploadForMediaType("document", {
      originalname: "report.csv",
      mimetype: "text/csv",
    }),
  );
});
