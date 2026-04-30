#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Orval's zod codegen emits a path-param schema and a query-param type that
// share the same identifier (`<Op>Params`) when an operation has both path
// AND query params. The two collide when re-exported via `export *`. We rename
// the path-only zod schema in the generated `api.ts` to `<Op>PathParams` to
// keep the wildcard re-export ambiguity-free.
const RENAMES = [
  ["FilesGetFoldersIdFilesParams", "FilesGetFoldersIdFilesPathParams"],
  ["ScheduleGetJobsJobIdScheduleParams", "ScheduleGetJobsJobIdSchedulePathParams"],
  ["DailyLogsGetJobsJobIdDailyLogsParams", "DailyLogsGetJobsJobIdDailyLogsPathParams"],
];

const here = path.dirname(fileURLToPath(import.meta.url));
const apiZodFile = path.resolve(here, "..", "..", "api-zod", "src", "generated", "api.ts");

const original = await readFile(apiZodFile, "utf8");
let next = original;

for (const [from, to] of RENAMES) {
  // Only the standalone identifier (not part of QueryParams etc.).
  next = next.replace(new RegExp(`\\b${from}\\b(?!Q)`, "g"), to);
}

if (next !== original) {
  await writeFile(apiZodFile, next, "utf8");
  console.log(`[post-codegen] Renamed ${RENAMES.length} colliding zod path-param schemas in ${path.relative(process.cwd(), apiZodFile)}`);
} else {
  console.log("[post-codegen] No renames applied.");
}
