import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// ---------------------------------------------------------------------------
// Build-output regression guard for #274.
//
// Background: file-type@22, mammoth, exceljs and fflate use ESM dynamic
// imports that esbuild cannot statically include. When we previously
// bundled file-type into dist/index.mjs, production crashed at the
// first PDF upload with `Cannot find package 'strtok3'` because the
// transitive dep was never installed against `dist/`'s node_modules
// graph. These tests verify:
//
//   (a) `dist/index.mjs` exists.
//   (b) `dist/index.mjs` does NOT inline `strtok3`/`peek-readable`/
//       `token-types`/`@tokenizer/inflate` — they must remain real
//       runtime imports so node resolves them from node_modules.
//   (c) `node --input-type=module -e "import('./dist/index.mjs')…"`
//       loads the bundle without `ERR_MODULE_NOT_FOUND`.
//   (d) `fileTypeFromFile(<real PDF>)` returns `application/pdf` when
//       called via a child node process — the same path production
//       upload validation takes.
// ---------------------------------------------------------------------------

const apiServerDir = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const distEntry = path.join(apiServerDir, "dist", "index.mjs");

test("build-smoke: dist/index.mjs is present (run `pnpm --filter @workspace/api-server run build` first)", () => {
  assert.equal(
    existsSync(distEntry),
    true,
    `Expected built bundle at ${distEntry}. Run \`pnpm --filter @workspace/api-server run build\` before running this test.`,
  );
});

test("build-smoke: dist/index.mjs does not statically bundle dynamic-import packages", () => {
  if (!existsSync(distEntry)) {
    // The presence test above already failed; don't double-report.
    return;
  }
  const source = readFileSync(distEntry, "utf8");

  // Each package below is loaded by file-type's dynamic detector graph
  // (or by mammoth/exceljs). If esbuild ever inlines one of them again
  // we lose runtime resolvability against `pnpm install --prod`'s
  // node_modules and uploads start failing with `ERR_MODULE_NOT_FOUND`.
  const forbiddenStaticImports: Array<[label: string, pattern: RegExp]> = [
    ["strtok3", /from\s*["']strtok3(?:\/[^"']+)?["']/],
    ["peek-readable", /from\s*["']peek-readable["']/],
    ["token-types", /from\s*["']token-types["']/],
    ["@tokenizer/inflate", /from\s*["']@tokenizer\/inflate["']/],
    ["@tokenizer/token", /from\s*["']@tokenizer\/token["']/],
    // #286: exceljs replaced the abandoned `xlsx` package. It must
    // remain external so its dynamic-import graph (archiver, unzipper,
    // fast-csv, saxes, etc.) resolves from node_modules at runtime.
    ["exceljs", /from\s*["']exceljs(?:\/[^"']+)?["']/],
  ];

  for (const [label, pattern] of forbiddenStaticImports) {
    assert.equal(
      pattern.test(source),
      false,
      `dist/index.mjs unexpectedly inlines a static import of "${label}". ` +
        `It must be externalized in artifacts/api-server/build.mjs so node ` +
        `resolves it from node_modules at runtime.`,
    );
  }
});

function runNode(
  args: string[],
  options: { timeoutMs: number; cwd?: string } = { timeoutMs: 15_000 },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd ?? apiServerDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Don't connect to anything during the import-only smoke check.
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `node ${args.join(" ")} did not exit within ${options.timeoutMs}ms. stderr=${stderr}`,
        ),
      );
    }, options.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test("build-smoke: dist/index.mjs loads without ERR_MODULE_NOT_FOUND", async () => {
  if (!existsSync(distEntry)) return;
  const result = await runNode(
    [
      "--input-type=module",
      "-e",
      "import('./dist/index.mjs').then(()=>{console.log('LOAD_OK');process.exit(0)}).catch(e=>{console.error('LOAD_FAIL',e&&e.code,e&&e.message);process.exit(1)})",
    ],
    { timeoutMs: 30_000 },
  );
  assert.equal(
    result.code,
    0,
    `Bundle failed to load. stdout=${result.stdout} stderr=${result.stderr}`,
  );
  assert.match(result.stdout, /LOAD_OK/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
});

test("build-smoke: file-type sniffs a real PDF when resolved against api-server's node_modules", async () => {
  // This proves `pnpm install --prod` (or pnpm hoisting) actually puts
  // strtok3 / token-types / @tokenizer/inflate where node can find
  // them when file-type's dynamic detectors fire — the exact crash path
  // from the production logs in #274.
  const result = await runNode(
    [
      "--input-type=module",
      "-e",
      `
        import('file-type').then(async (m) => {
          const fs = await import('node:fs/promises');
          const os = await import('node:os');
          const path = await import('node:path');
          const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sniff-'));
          const pdf = path.join(tmp, 'sniff.pdf');
          // Minimal valid PDF: %PDF- header is all file-type needs.
          await fs.writeFile(pdf, Buffer.from('%PDF-1.4\\n%\\xC4\\xE5\\xF2\\xE5\\xEB\\xA7\\n%%EOF\\n', 'binary'));
          const t = await m.fileTypeFromFile(pdf);
          await fs.rm(tmp, { recursive: true, force: true });
          if (!t || t.mime !== 'application/pdf') {
            console.error('SNIFF_BAD', JSON.stringify(t));
            process.exit(1);
          }
          console.log('SNIFF_OK', t.mime);
          process.exit(0);
        }).catch((e) => {
          console.error('SNIFF_THROW', e && e.code, e && e.message);
          process.exit(1);
        });
      `,
    ],
    { timeoutMs: 20_000 },
  );
  assert.equal(
    result.code,
    0,
    `file-type sniff failed. stdout=${result.stdout} stderr=${result.stderr}`,
  );
  assert.match(result.stdout, /SNIFF_OK application\/pdf/);
});
