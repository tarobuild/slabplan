import assert from "node:assert/strict";
import { test } from "node:test";

const fixtureUser = {
  id: "1f4c4fb7-43cb-4f40-b373-4f42466389a1",
  email: "worker@example.com",
  fullName: "Worker Example",
  role: "crew_member",
  avatarUrl: null,
  phone: null,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-02T00:00:00.000Z"),
};

test("upload tokens use the dedicated upload secret", async () => {
  const originalAccessSecret = process.env.JWT_ACCESS_SECRET;
  const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const originalResetSecret = process.env.JWT_RESET_SECRET;
  const originalUploadSecret = process.env.JWT_UPLOAD_SECRET;

  process.env.JWT_ACCESS_SECRET = "access-secret-for-tests";
  process.env.JWT_REFRESH_SECRET = "refresh-secret-for-tests";
  process.env.JWT_RESET_SECRET = "reset-secret-for-tests";
  process.env.JWT_UPLOAD_SECRET = "upload-secret-for-tests";

  try {
    const authModule = await import(`../src/lib/auth.ts?test=${Date.now()}`);
    const uploadToken = authModule.signUploadToken(fixtureUser);

    assert.equal(authModule.verifyUploadToken(uploadToken).userId, fixtureUser.id);
    assert.throws(() => authModule.verifyAccessToken(uploadToken));
  } finally {
    restoreEnv("JWT_ACCESS_SECRET", originalAccessSecret);
    restoreEnv("JWT_REFRESH_SECRET", originalRefreshSecret);
    restoreEnv("JWT_RESET_SECRET", originalResetSecret);
    restoreEnv("JWT_UPLOAD_SECRET", originalUploadSecret);
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
