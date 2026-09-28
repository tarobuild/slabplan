import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

type CapturedEmail = { to: string; subject: string; text: string; html: string; tag: string };

const RECIPIENT = "security-alerts@example.test";
const RUN_URL = "https://github.com/example-owner/example-repo/actions/runs/123456789";
const captured: CapturedEmail[] = [];
let email: typeof import("../src/lib/email.ts");

function captureSender() {
  email.__setEmailSenderForTests({
    async send(message) {
      captured.push(message);
      return { id: "captured-backup-alert" };
    },
  });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  email = await import("../src/lib/email.ts");
  captureSender();
});

beforeEach(() => {
  captured.length = 0;
});

after(() => {
  email.__setEmailSenderForTests(null);
});

test("a backup failure alert uses wording valid for database and private-file backups", async () => {
  const result = await email.sendBackupFailureEmail(RECIPIENT, RUN_URL);
  assert.deepEqual(result, { id: "captured-backup-alert" });
  assert.equal(captured.length, 1);
  const [message] = captured;
  assert.equal(message.to, RECIPIENT);
  assert.equal(message.tag, "security-alert");
  assert.equal(message.subject, "SlabPlan scheduled backup needs attention");
  assert.doesNotMatch(
    `${message.subject}\n${message.text}\n${message.html}`,
    /database backup needs attention/i,
    "the alert must not name only the database backup",
  );
  assert.match(message.text, /database or private files/);
  assert.match(message.text, /Open the workflow run to see which backup failed/);
  assert.ok(message.text.endsWith(`\n\nWorkflow: ${RUN_URL}`));
  assert.ok(message.html.includes(`href="${RUN_URL}"`));
  assert.match(message.html, /Review workflow/);
  assert.match(message.html, /SlabPlan scheduled backup needs attention/);
});

test("the delivery test message is unchanged and reports no failure", async () => {
  await email.sendBackupFailureEmail(RECIPIENT, RUN_URL, true);
  assert.equal(captured.length, 1);
  const [message] = captured;
  assert.equal(message.to, RECIPIENT);
  assert.equal(message.tag, "security-alert");
  assert.equal(message.subject, "SlabPlan backup alert delivery test");
  assert.equal(
    message.text,
    `This is a delivery test. No backup failure is being reported.\n\nWorkflow: ${RUN_URL}`,
  );
  assert.ok(message.html.includes(`href="${RUN_URL}"`));
  assert.doesNotMatch(message.text, /failed/);
});

test("a delivery error still reaches the caller", async () => {
  email.__setEmailSenderForTests({
    async send() {
      throw new Error("captured sender unavailable");
    },
  });
  try {
    await assert.rejects(
      email.sendBackupFailureEmail(RECIPIENT, RUN_URL),
      /captured sender unavailable/,
    );
  } finally {
    captureSender();
  }
});
