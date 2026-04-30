import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";

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

test("upload tokens use the dedicated upload secret when configured", async () => {
  const originalAccessSecret = process.env.JWT_ACCESS_SECRET;
  const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const originalUploadSecret = process.env.JWT_UPLOAD_SECRET;

  process.env.JWT_ACCESS_SECRET = "access-secret-for-tests";
  process.env.JWT_REFRESH_SECRET = "refresh-secret-for-tests";
  process.env.JWT_UPLOAD_SECRET = "upload-secret-for-tests";

  try {
    const authModule = await import(`../src/lib/auth.ts?test=${Date.now()}`);
    const uploadToken = authModule.signUploadToken(fixtureUser);

    assert.equal(authModule.verifyUploadToken(uploadToken).userId, fixtureUser.id);
    assert.doesNotThrow(() => jwt.verify(uploadToken, "upload-secret-for-tests"));
    assert.throws(() => jwt.verify(uploadToken, "access-secret-for-tests"));
  } finally {
    restoreEnv("JWT_ACCESS_SECRET", originalAccessSecret);
    restoreEnv("JWT_REFRESH_SECRET", originalRefreshSecret);
    restoreEnv("JWT_UPLOAD_SECRET", originalUploadSecret);
  }
});

test("production throws on missing JWT_UPLOAD_SECRET", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAccessSecret = process.env.JWT_ACCESS_SECRET;
  const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const originalUploadSecret = process.env.JWT_UPLOAD_SECRET;

  process.env.NODE_ENV = "production";
  process.env.JWT_ACCESS_SECRET = "access-secret-for-tests";
  process.env.JWT_REFRESH_SECRET = "refresh-secret-for-tests";
  delete process.env.JWT_UPLOAD_SECRET;

  try {
    await assert.rejects(
      () => import(`../src/lib/auth.ts?test=fallback-${Date.now()}`),
      /JWT_UPLOAD_SECRET must be configured in production/,
    );
  } finally {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("JWT_ACCESS_SECRET", originalAccessSecret);
    restoreEnv("JWT_REFRESH_SECRET", originalRefreshSecret);
    restoreEnv("JWT_UPLOAD_SECRET", originalUploadSecret);
  }
});

test("auth router does not expose forgot-password or reset-password endpoints", async () => {
  const originalAccessSecret = process.env.JWT_ACCESS_SECRET;
  const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const originalUploadSecret = process.env.JWT_UPLOAD_SECRET;

  process.env.JWT_ACCESS_SECRET = "access-secret-for-tests";
  process.env.JWT_REFRESH_SECRET = "refresh-secret-for-tests";
  process.env.JWT_UPLOAD_SECRET = "upload-secret-for-tests";

  try {
    const routerModule = await import(`../src/routes/auth.ts?test=${Date.now()}`);
    const stack = routerModule.default?.stack ?? [];
    const paths = stack
      .filter((layer: { route?: { path?: string } }) => Boolean(layer.route?.path))
      .map((layer: { route: { path: string } }) => layer.route.path);

    assert.ok(
      !paths.includes("/forgot-password"),
      "auth router must not expose /forgot-password (admin manages passwords directly)",
    );
    assert.ok(
      !paths.includes("/reset-password"),
      "auth router must not expose /reset-password (admin manages passwords directly)",
    );
  } finally {
    restoreEnv("JWT_ACCESS_SECRET", originalAccessSecret);
    restoreEnv("JWT_REFRESH_SECRET", originalRefreshSecret);
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
