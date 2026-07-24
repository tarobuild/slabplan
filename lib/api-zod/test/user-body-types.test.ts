import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  UsersPostUsersMePasswordBody,
  UsersPutUsersMeBody,
} from "../src/generated/api.ts";

const readGeneratedType = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("generated user body types expose concrete profile and password contracts", () => {
  const profile = readGeneratedType(
    "../src/generated/types/usersUpdateProfileSchema.ts",
  );
  const password = readGeneratedType(
    "../src/generated/types/usersChangePasswordSchema.ts",
  );

  assert.doesNotMatch(profile, /\[key: string\]: unknown;/);
  assert.match(profile, /fullName\?: string;/);
  assert.match(profile, /email\?: string;/);
  assert.match(profile, /currentPassword\?: string \| null;/);
  assert.match(profile, /phone\?: string \| null;/);
  assert.match(profile, /avatarUrl\?: string \| null;/);

  assert.doesNotMatch(password, /\[key: string\]: unknown;/);
  assert.match(password, /currentPassword: string;/);
  assert.match(password, /newPassword: string;/);
});

test("generated user body validators reject unsupported fields", () => {
  assert.equal(
    UsersPutUsersMeBody.safeParse({ unsupported: "x" }).success,
    false,
  );
  assert.equal(
    UsersPostUsersMePasswordBody.safeParse({
      currentPassword: "old-password",
      newPassword: "new-password",
      unsupported: "x",
    }).success,
    false,
  );
});
