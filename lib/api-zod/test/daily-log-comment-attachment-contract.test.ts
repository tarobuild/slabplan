import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const readGenerated = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("daily log comment attachments expose legacy and file-backed identifiers", () => {
  const attachment = readGenerated(
    "../src/generated/types/dailyLogCommentAttachment.ts",
  );
  const comment = readGenerated("../src/generated/types/dailyLogComment.ts");
  const createdResponse = readGenerated(
    "../src/generated/types/dailyLogCommentAttachmentsCreatedResponseFilesItem.ts",
  );
  const generatedApi = readGenerated("../src/generated/api.ts");

  assert.match(comment, /attachments: DailyLogCommentAttachment\[\];/);

  assert.match(attachment, /name: string;/);
  assert.match(attachment, /url: string \| null;/);
  assert.match(attachment, /fileId\?: string \| null;/);
  assert.match(attachment, /fileUrl\?: string \| null;/);
  assert.match(attachment, /mimeType\?: string \| null;/);

  assert.match(createdResponse, /id: string;/);
  assert.match(createdResponse, /fileUrl: string \| null;/);

  assert.match(generatedApi, /fileId: zod\.string\(\)\.uuid\(\)\.nullish\(\)/);
  assert.match(generatedApi, /fileUrl: zod\.string\(\)\.nullish\(\)/);
});
