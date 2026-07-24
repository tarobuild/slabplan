import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  __setEmailSenderForTests,
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
    /Transactional email provider is not configured/,
  );
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
