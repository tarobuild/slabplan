import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DailyLogsGetDailyLogsFeedQueryParams,
  FilesGetFoldersIdFilesQueryParams,
  UsersGetUsersQueryParams,
} from "../src/generated/api.ts";

test("generated boolean query params parse true and false strings literally", () => {
  const users = UsersGetUsersQueryParams.parse({ includeInactive: "false" });
  assert.equal(users.includeInactive, false);

  const dailyLogs = DailyLogsGetDailyLogsFeedQueryParams.parse({
    hasAttachments: "false",
    hasComments: "true",
  });
  assert.equal(dailyLogs.hasAttachments, false);
  assert.equal(dailyLogs.hasComments, true);

  const files = FilesGetFoldersIdFilesQueryParams.parse({
    includeDeleted: "false",
  });
  assert.equal(files.includeDeleted, false);
});

test("generated boolean query params reject non-boolean strings", () => {
  assert.equal(
    UsersGetUsersQueryParams.safeParse({ includeInactive: "yes" }).success,
    false,
  );
  assert.equal(
    DailyLogsGetDailyLogsFeedQueryParams.safeParse({ hasComments: "0" })
      .success,
    false,
  );
});
