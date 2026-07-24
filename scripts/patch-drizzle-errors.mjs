#!/usr/bin/env node
// Patch drizzle-orm's DrizzleQueryError so error.message includes the
// underlying pg error's message (constraint name, etc). Without this,
// `(err as Error).message` only shows "Failed query: ...\nparams: ..."
// and tests/log scrapers cannot grep the constraint name out of it.
//
// Wired in via the workspace package.json `postinstall` script so it
// runs automatically after every `pnpm install`. Idempotent.
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "node_modules/.pnpm";

const SENTINEL = "/*drizzle-error-cause-patched*/";
const NEEDLE = "super(`Failed query: ${query}\nparams: ${params}`);";
const REPLACEMENT =
  `${SENTINEL}\n    const __causeMsg = cause && typeof cause.message === "string" ? cause.message : "";\n    super(\`Failed query: \${query}\nparams: \${params}\${__causeMsg ? \`\\n\${__causeMsg}\` : ""}\`);`;

if (!existsSync(ROOT)) {
  // Nothing to do — pnpm hasn't created the .pnpm store yet.
  process.exit(0);
}

let patched = 0;
let alreadyPatched = 0;
let drizzleDirsSeen = 0;
const failures = [];

for (const dir of readdirSync(ROOT)) {
  if (!dir.startsWith("drizzle-orm@")) continue;
  const base = join(ROOT, dir, "node_modules/drizzle-orm");
  try {
    statSync(base);
  } catch {
    continue;
  }
  drizzleDirsSeen++;
  let touchedThisDir = false;
  for (const file of ["errors.js", "errors.cjs"]) {
    const path = join(base, file);
    let src;
    try {
      src = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    touchedThisDir = true;
    if (src.includes(SENTINEL)) {
      alreadyPatched++;
      continue;
    }
    if (!src.includes(NEEDLE)) {
      failures.push(
        `needle not found in ${path}; drizzle-orm internals changed — update scripts/patch-drizzle-errors.mjs`,
      );
      continue;
    }
    writeFileSync(path, src.replace(NEEDLE, REPLACEMENT));
    patched++;
    console.log(`[patch-drizzle-errors] patched ${path}`);
  }
  if (!touchedThisDir) {
    failures.push(
      `no errors.{js,cjs} found under ${base}; drizzle-orm layout changed — update scripts/patch-drizzle-errors.mjs`,
    );
  }
}

if (drizzleDirsSeen === 0) {
  // Likely running before drizzle-orm has been installed (e.g. very early
  // in a fresh install). Don't fail the install for this.
  console.log("[patch-drizzle-errors] no drizzle-orm install detected; skipping");
  process.exit(0);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`[patch-drizzle-errors] ERROR: ${f}`);
  process.exit(1);
}

console.log(
  `[patch-drizzle-errors] done: patched=${patched} alreadyPatched=${alreadyPatched}`,
);
