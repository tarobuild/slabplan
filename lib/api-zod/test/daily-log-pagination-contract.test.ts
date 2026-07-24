import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedTypesDir = path.resolve(here, "../src/generated/types");

test("generated cursor pagination docs say cursor key, not limit alone, selects cursor mode", async () => {
  const dailyLogListResponse = await readFile(
    path.join(generatedTypesDir, "dailyLogListResponse.ts"),
    "utf8",
  );
  const myDailyLogsResponse = await readFile(
    path.join(generatedTypesDir, "myDailyLogsResponse.ts"),
    "utf8",
  );
  const cursorParam = await readFile(
    path.join(generatedTypesDir, "cursorParamParameter.ts"),
    "utf8",
  );
  const filesListParams = await readFile(
    path.join(generatedTypesDir, "filesGetFoldersIdFilesParams.ts"),
    "utf8",
  );
  const leadsListParams = await readFile(
    path.join(generatedTypesDir, "leadsGetLeadsParams.ts"),
    "utf8",
  );
  const searchResponse = await readFile(
    path.join(generatedTypesDir, "searchGetSearch200.ts"),
    "utf8",
  );
  const searchPagination = await readFile(
    path.join(generatedTypesDir, "searchGetSearch200Pagination.ts"),
    "utf8",
  );

  for (const source of [
    dailyLogListResponse,
    myDailyLogsResponse,
    cursorParam,
    filesListParams,
    leadsListParams,
    searchResponse,
    searchPagination,
  ]) {
    assert.doesNotMatch(source, /or simply `\?limit=N`/);
    assert.doesNotMatch(source, /`\?cursor=`\s*(?:\/|or)\s*`\?limit=/);
    assert.match(
      source,
      /A `limit` query (?:by itself|without `cursor`)\s*does not select cursor mode/s,
    );
  }
});
