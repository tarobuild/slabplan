import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  __setEmailSenderForTests,
  createSmtpEmailSender,
  readSmtpEmailConfig,
  sendInvite,
} from "../src/lib/email.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

test("production email sender fails loudly when no approved provider is configured", async () => {
  __setEmailSenderForTests(null);

  await assert.rejects(
    () =>
      sendInvite({
        to: "worker@example.com",
        inviteLink: "https://app.example.com/accept-invite/token",
        inviterName: "Admin",
      }),
    /required for transactional email/,
  );
});

test("SMTP configuration is strict and defaults Google Workspace port 465 to TLS", () => {
  const config = readSmtpEmailConfig({
    EMAIL_PROVIDER: "smtp",
    SMTP_HOST: "smtp.gmail.com",
    SMTP_USER: "sales@tarobuild.com",
    SMTP_PASSWORD: "test-app-password",
    SMTP_FROM_NAME: "SlabPlan",
  });

  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.equal(config.requireTls, false);
  assert.equal(config.fromEmail, "sales@tarobuild.com");
});

test("SMTP sender emits branded text and HTML without exposing credentials", async () => {
  const config = readSmtpEmailConfig({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "465",
    SMTP_USER: "sales@tarobuild.com",
    SMTP_PASSWORD: "test-app-password",
  });
  let message: Record<string, unknown> | null = null;
  const sender = createSmtpEmailSender(config, {
    async sendMail(options) {
      message = options;
      return { messageId: "smtp-test-id" };
    },
  });

  const result = await sender.send({
    to: "worker@example.com",
    subject: "Test",
    text: "Plain text",
    html: "<strong>SlabPlan</strong>",
    tag: "invite",
  });

  assert.equal(result.id, "smtp-test-id");
  assert.equal(message?.to, "worker@example.com");
  assert.equal(message?.html, "<strong>SlabPlan</strong>");
  assert.doesNotMatch(JSON.stringify(message), /test-app-password/);
});

test("api-server does not depend on the excluded email provider", async () => {
  const manifest = await readFile(
    path.join(root, "artifacts/api-server/package.json"),
    "utf8",
  );
  const lockfile = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");

  assert.doesNotMatch(manifest, /"resend"\s*:/i);
  assert.doesNotMatch(lockfile, /\n\s*resend:/i);
  assert.doesNotMatch(lockfile, /\n\s*resend@/i);
});

test("tests can still stub transactional email delivery", async () => {
  const previous = __setEmailSenderForTests({
    async send() {
      return { id: "test-stub" };
    },
  });

  try {
    const sent = await sendInvite({
      to: "worker@example.com",
      inviteLink: "https://app.example.com/accept-invite/token",
      inviterName: "Admin",
    });
    assert.equal(sent.id, "test-stub");
  } finally {
    __setEmailSenderForTests(previous);
  }
});
