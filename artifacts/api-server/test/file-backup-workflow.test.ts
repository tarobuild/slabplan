import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const AUTH_ACTION = "google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093";

async function workflow(name: string) {
  return await readFile(path.join(repoRoot, ".github/workflows", name), "utf8");
}

for (const name of ["file-backup.yml", "file-restore-drill.yml"]) {
  test(`${name} uses short-lived federated Google credentials from a protected environment`, async () => {
    const text = await workflow(name);
    assert.match(text, /environment: private-file-backup/);
    assert.match(text, /id-token: write/);
    assert.ok(text.includes(AUTH_ACTION), "auth action must be pinned to a reviewed commit");
    assert.doesNotMatch(text, /credentials_json|GOOGLE_CREDENTIALS|service_account_key/i, "no long-lived Google keys");
    assert.doesNotMatch(text, /pull_request/, "backup credentials must never be exposed to pull requests");
    assert.match(text, /persist-credentials: false/);
    assert.doesNotMatch(text, /upload-artifact/, "restored data and credential files must not become artifacts");
    assert.doesNotMatch(text, /pnpm install/, "backup scripts run without the application dependency tree");
    // The encryption key is scoped to the steps that decrypt or encrypt, never
    // the job, so the third-party auth action's environment never holds it.
    const jobEnv = /\n    env:\n((?: {6}.*\n)+)/.exec(text)?.[1] ?? "";
    assert.doesNotMatch(jobEnv, /FILE_BACKUP_ENCRYPTION_KEY: \$\{\{ secrets\./);
    const authStep = text.slice(text.indexOf("Authenticate to Google Cloud"), text.indexOf("\n      - name:", text.indexOf("Authenticate to Google Cloud")));
    assert.doesNotMatch(authStep, /FILE_BACKUP_ENCRYPTION_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  });
}

test("the scheduled backup runs after the database backup, fails loudly when unconfigured and alerts", async () => {
  const text = await workflow("file-backup.yml");
  assert.match(text, /cron: "30 10 \* \* \*"/);
  assert.match(await workflow("db-backup.yml"), /cron: "0 9 \* \* \*"/);
  assert.match(text, /Private-file backup is not configured; missing/);
  // The sample check verifies the run this job wrote, never a later "latest".
  assert.match(text, /run_id="\$\(jq -r '\.runId' "\$SUMMARY_PATH"\)"/);
  assert.match(text, /file-backup-restore\.mjs verify --run "\$run_id" --sample 10/);
  assert.doesNotMatch(text, /--run latest/);
  assert.match(text, /needs\.backup\.result == 'failure'/);
  assert.match(text, /\/api\/internal\/backup-alert/);
  assert.match(text, /cancel-in-progress: false/);
  const statusStep = text.slice(text.indexOf("Record run status"), text.indexOf("  alert:"));
  assert.doesNotMatch(statusStep, /organizations|manifestEntries|bytes|carried/, "public step summary must not disclose volumes");
});

test("the restore drill is manual, validates inputs and never writes production", async () => {
  const text = await workflow("file-restore-drill.yml");
  assert.match(text, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(text, /schedule:/);
  assert.doesNotMatch(text, /--to-supabase|--allow-primary-target/);
  assert.match(text, /Validate drill inputs/);
  assert.match(text, /check-db-files/);
  // Database restores fail closed through the shared verifier.
  assert.doesNotMatch(text, /\|\|\s*true/, "restore errors must never be waived");
  assert.doesNotMatch(text, /ON_ERROR_STOP=0/);
  assert.match(text, /file-backup-db-verify\.mjs --dump "\$dump" --files-csv/);
  // One immutable run is resolved once and reused, so a backup finishing
  // mid-drill cannot mix snapshots between steps.
  const invocations = [...text.matchAll(/file-backup-restore\.mjs (\S+) --run "\$(\w+)"/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(invocations.filter(([command]) => command === "resolve-run"), [["resolve-run", "DRILL_RUN"]]);
  const pinnedSteps = invocations.filter(([command]) => command !== "resolve-run");
  assert.deepEqual(pinnedSteps.map(([command]) => command).sort(), ["check-db-files", "db-dump", "restore", "verify"]);
  assert.ok(pinnedSteps.every(([, variable]) => variable === "DRILL_RUN_ID"), JSON.stringify(pinnedSteps));
  assert.ok(text.indexOf("resolve-run") < text.indexOf('verify --run "$DRILL_RUN_ID"'));
  assert.match(text, /echo "DRILL_RUN_ID=\$run_id" >> "\$GITHUB_ENV"/);
  assert.match(text, /concurrency:\s*\n\s*group: private-file-restore-drill/);
  // Inputs reach shell only through environment variables.
  assert.doesNotMatch(text, /run: .*\$\{\{\s*inputs\./);
});

test("backup scripts depend only on Node built-ins and local helpers", async () => {
  const files = [
    "scripts/file-backup.mjs",
    "scripts/file-backup-restore.mjs",
    "scripts/file-backup-db-verify.mjs",
    "scripts/lib/pg-restore.mjs",
    "scripts/lib/multipart-manifest.mjs",
    "scripts/lib/backup-crypto.mjs",
    "scripts/lib/gcs-backup-store.mjs",
    "scripts/lib/file-backup-manifest.mjs",
    "scripts/lib/supabase-storage.mjs",
  ];
  for (const file of files) {
    const text = await readFile(path.join(repoRoot, "artifacts/api-server", file), "utf8");
    for (const match of text.matchAll(/^import .* from "([^"]+)";$/gm)) {
      assert.ok(match[1].startsWith("node:") || match[1].startsWith("./"), `${file} imports ${match[1]}`);
    }
  }
});
