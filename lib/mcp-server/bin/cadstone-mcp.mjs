#!/usr/bin/env node
/**
 * CLI shim for the CAD Stone MCP server.
 *
 * Defers to tsx so the source TypeScript can be executed directly without a
 * build step — handy for local development and for `pnpm exec cadstone-mcp`
 * inside this monorepo. Production deployments can swap tsx for `node` once
 * the package has a real `dist/` build.
 *
 * We resolve `tsx/esm` via `createRequire` so the loader path works on
 * Windows (where the bare specifier would otherwise be passed as-is and
 * mis-resolved by Node's `--import` flag) and inside pnpm symlinked
 * `node_modules` trees where the loader does not necessarily live next to
 * this binary.
 */
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../src/stdio.ts");
const require = createRequire(import.meta.url);

let tsxLoader;
try {
  tsxLoader = pathToFileURL(require.resolve("tsx/esm")).href;
} catch (err) {
  process.stderr.write(
    "[cadstone-mcp] failed to locate tsx/esm loader. Reinstall the package: " +
      (err && err.message ? err.message : String(err)) +
      "\n",
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ["--import", tsxLoader, entry, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, MCP_STDIO_DIRECT: "1" },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
