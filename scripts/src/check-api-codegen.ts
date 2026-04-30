import { execFileSync, spawnSync } from "node:child_process";
import * as path from "node:path";
import * as url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const GENERATED_PATHS = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
];

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function captureGitStatus(paths: string[]): string {
  const out = execFileSync(
    "git",
    ["--no-optional-locks", "status", "--porcelain", "--", ...paths],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    },
  );
  return out;
}

console.log("Running API codegen to check for drift...");
run("pnpm", ["--filter", "@workspace/api-spec", "run", "codegen"]);

console.log("\nChecking for drift under generated client directories...");
const drift = captureGitStatus(GENERATED_PATHS);

if (drift.trim().length > 0) {
  console.error("");
  console.error(
    "ERROR: Generated API client code is out of sync with lib/api-spec/openapi.yaml.",
  );
  console.error("");
  console.error("Drifted files:");
  console.error(drift);
  console.error(
    "Fix: run `pnpm --filter @workspace/api-spec run codegen` and commit the resulting changes under:",
  );
  for (const p of GENERATED_PATHS) {
    console.error(`  - ${p}/`);
  }
  process.exit(1);
}

console.log(
  "OK: generated API clients are up to date with lib/api-spec/openapi.yaml.",
);
