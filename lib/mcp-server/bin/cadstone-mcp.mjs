#!/usr/bin/env node
/**
 * CLI shim for the CAD Stone MCP server.
 *
 * Runs the built stdio entrypoint. Build @workspace/mcp-server before using
 * this binary outside a tsx development command.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../dist/stdio.js");
const signalExitCodes = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};
let terminating = false;
let forceKillTimer = null;

const child = spawn(
  process.execPath,
  [entry, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, MCP_STDIO_DIRECT: "1" },
  },
);

function clearForceKillTimer() {
  if (forceKillTimer) {
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
  }
}

for (const signal of Object.keys(signalExitCodes)) {
  process.on(signal, () => {
    if (terminating) {
      return;
    }
    terminating = true;
    child.kill(signal);
    forceKillTimer = setTimeout(() => {
      child.kill("SIGKILL");
      process.exit(signalExitCodes[signal]);
    }, 5_000);
    forceKillTimer.unref();
  });
}

child.on("exit", (code, signal) => {
  clearForceKillTimer();
  if (signal) {
    process.exit(signalExitCodes[signal] ?? 1);
  }
  process.exit(code ?? 0);
});
