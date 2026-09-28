import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Operational .mjs helper has no declaration file.
import { selectBackupSizeBaseline } from "../scripts/lib/backup-size-baseline.mjs";

test("restored baseline replaces pre-review history without disabling size comparisons", () => {
  const result = selectBackupSizeBaseline([
    { dateStr: "2026-09-24", sizeBytes: 100 },
    { dateStr: "2026-09-25", sizeBytes: 100 },
    { dateStr: "2026-09-26", sizeBytes: 100 },
  ], { BACKUP_REVIEWED_BASELINE_DATE: "2026-09-27", BACKUP_REVIEWED_BASELINE_BYTES: "200" }, "2026-09-27");
  assert.equal(result.bytes, 200);
  assert.equal(result.source, "reviewed_restore");
  assert.ok(50 < result.bytes * 0.5, "a truncated backup remains outside tolerance");
  assert.ok(400 > result.bytes * 1.5, "unexpected growth remains outside tolerance");
});

test("normal rolling comparison resumes after three post-review samples", () => {
  const result = selectBackupSizeBaseline([
    { dateStr: "2026-09-26", sizeBytes: 100 },
    { dateStr: "2026-09-27", sizeBytes: 200 },
    { dateStr: "2026-09-28", sizeBytes: 220 },
    { dateStr: "2026-09-29", sizeBytes: 230 },
  ], { BACKUP_REVIEWED_BASELINE_DATE: "2026-09-27", BACKUP_REVIEWED_BASELINE_BYTES: "200" }, "2026-09-30");
  assert.equal(result.bytes, 220);
  assert.equal(result.source, "trailing_median");
});

test("without a reviewed baseline the original median and insufficient-history behavior remain", () => {
  assert.equal(selectBackupSizeBaseline([], {}, "2026-09-27"), null);
  assert.equal(selectBackupSizeBaseline([100, 200, 300, 400].map(sizeBytes => ({ sizeBytes })), {}, "2026-09-27").bytes, 250);
});

test("invalid, incomplete, and future reviewed baselines fail closed", () => {
  for (const env of [
    { BACKUP_REVIEWED_BASELINE_DATE: "2026-09-27" },
    { BACKUP_REVIEWED_BASELINE_BYTES: "200" },
    { BACKUP_REVIEWED_BASELINE_DATE: "2026-09-28", BACKUP_REVIEWED_BASELINE_BYTES: "200" },
    { BACKUP_REVIEWED_BASELINE_DATE: "2026-02-30", BACKUP_REVIEWED_BASELINE_BYTES: "200" },
    { BACKUP_REVIEWED_BASELINE_DATE: "2026-09-27", BACKUP_REVIEWED_BASELINE_BYTES: "0" },
  ]) assert.throws(() => selectBackupSizeBaseline([], env, "2026-09-27"));
});
