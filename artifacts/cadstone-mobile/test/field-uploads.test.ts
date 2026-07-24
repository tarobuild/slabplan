import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const uploadsSource = readFileSync(resolve(here, "../src/lib/uploads.ts"), "utf8");
const apiSource = readFileSync(resolve(here, "../src/lib/api.ts"), "utf8");
const folderFilesSource = readFileSync(resolve(here, "../src/screens/FolderFilesScreen.tsx"), "utf8");
const scheduleScreenSource = readFileSync(resolve(here, "../src/screens/ScheduleItemScreen.tsx"), "utf8");
const scheduleRouteSource = readFileSync(resolve(here, "../../api-server/src/routes/schedule.ts"), "utf8");
const docsSource = readFileSync(resolve(here, "../../../docs/mobile-app.md"), "utf8");

test("field uploads support jobsite media and files without an artificial short video cap", () => {
  assert.match(uploadsSource, /launchImageLibraryAsync/);
  assert.match(uploadsSource, /mediaTypes: \["images", "videos"\]/);
  assert.match(uploadsSource, /getDocumentAsync\(\{/);
  assert.doesNotMatch(uploadsSource, /videoMaxDuration/);
});

test("schedule item screen lets field users add progress notes and attachments", () => {
  assert.match(scheduleScreenSource, /addScheduleItemNote/);
  assert.match(scheduleScreenSource, /Add field note/);
  assert.match(scheduleScreenSource, /Photos\/videos/);
  assert.match(scheduleScreenSource, /Files and drawings/);
  assert.match(scheduleScreenSource, /Attach to task/);
});

test("job folder uploads respect the office-selected folder upload permission", () => {
  assert.match(apiSource, /folderPermissionAllowsUser/);
  assert.match(apiSource, /permissions\.users\?\.\[user\.id\]/);
  assert.match(folderFilesSource, /canUploadToCurrentFolder/);
  assert.match(folderFilesSource, /Office has not enabled mobile uploads for this folder/);
  assert.match(folderFilesSource, /Photo note/);
});

test("schedule attachment route is a field collaborative upload path", () => {
  assert.match(scheduleRouteSource, /isCollaborativeAttachmentUpload/);
  assert.match(scheduleRouteSource, /req\.method === "POST" && path === "\/attachments"/);
  assert.match(scheduleRouteSource, /inferUploadedAttachmentMediaType/);
});

test("mobile docs include the field upload scope", () => {
  assert.match(docsSource, /Add field notes and attach jobsite photos, videos, and files to schedule items/);
  assert.match(docsSource, /Attach camera photos, library photos\/videos, and document-picker files/);
});
