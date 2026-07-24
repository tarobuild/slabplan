#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const result = spawnSync(
  process.platform === "win32" ? "tsc.cmd" : "tsc",
  ["-p", "tsconfig.json"],
  {
    cwd: packageDir,
    stdio: "inherit",
    shell: false,
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const distDir = path.join(packageDir, "dist");
const relativeImportPattern = /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const stat = statSync(abs);

    if (stat.isDirectory()) {
      walk(abs);
      continue;
    }

    if (!entry.endsWith(".js")) {
      continue;
    }

    const original = readFileSync(abs, "utf8");
    const next = original.replace(relativeImportPattern, (match, prefix, specifier, suffix) => {
      if (specifier.endsWith("/") || /\.(?:mjs|cjs|js|json|node)$/.test(specifier)) {
        return match;
      }

      return `${prefix}${specifier}.js${suffix}`;
    });

    if (next !== original) {
      writeFileSync(abs, next, "utf8");
    }
  }
}

walk(distDir);
