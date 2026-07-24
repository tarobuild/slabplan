import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { cp, rm, stat } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(artifactDir, "../..");

async function readGitShortSha(ref) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", ref], { cwd: repoRoot });
    const fromGit = stdout.trim();
    if (fromGit) return fromGit.slice(0, 12);
  } catch {
    return "";
  }

  return "";
}

function isReplitBuildEnvironment() {
  return Boolean(
    process.env.REPL_ID ||
    process.env.REPL_SLUG ||
    process.env.REPL_OWNER ||
    process.env.REPLIT_DEPLOYMENT ||
    process.env.REPLIT_GIT_COMMIT_SHA,
  );
}

async function resolveReleaseSha() {
  // Replit can keep local "Published your App" commits ahead of origin/main
  // after a Git UI pull. Production release verification must identify the
  // GitHub source commit, not those local deployment-history commits.
  const gitRefs = isReplitBuildEnvironment()
    ? ["@{upstream}", "origin/main", "HEAD"]
    : ["HEAD"];

  for (const ref of gitRefs) {
    const fromGit = await readGitShortSha(ref);
    if (fromGit) return fromGit;
  }

  const fromEnv =
    process.env.REPLIT_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT ||
    process.env.RELEASE_SHA ||
    "";
  if (fromEnv) return fromEnv.slice(0, 12);

  return "";
}

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });
  const releaseSha = await resolveReleaseSha();

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    conditions: ["workspace"],
    logLevel: "info",
    // Internal workspace packages such as @workspace/api-zod and
    // @workspace/mcp-server expose a custom "workspace" condition that points
    // at their TypeScript sources. Replit can invoke this package build
    // without first running the root tsc build that creates those packages'
    // dist/ outputs, so resolve the source condition while bundling the API
    // server instead of depending on prebuilt workspace package artifacts.
    conditions: ["workspace"],
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      // Note: `@opentelemetry/*` was previously externalized as a defensive
      // default. With @sentry/node added (Task #348), externalizing OTel
      // breaks runtime resolution because pnpm doesn't hoist the deeply-
      // nested OTel instrumentation packages into a location the api-server
      // dist can find. OpenTelemetry is pure JS, so bundling is safe.
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
      // `yaml` is loaded by routes/public-spec.ts to parse openapi.yaml at
      // request time. Bundling it pulls a large CJS graph into the ESM
      // bundle and currently breaks resolution; keeping it external mirrors
      // how it's used (a runtime require of the installed dep).
      "yaml",
      // The MCP SDK ships an ESM-only entry that uses dynamic require()
      // for transport adapters; bundling it produces broken require shims
      // under our esbuild config. Externalize so node loads it normally.
      "@modelcontextprotocol/sdk",
      "@modelcontextprotocol/sdk/*",
      // file-type@22 (and its transitive strtok3 / token-types /
      // @tokenizer/inflate / peek-readable graph) uses dynamic ESM
      // imports that esbuild can't statically follow. Bundling silently
      // drops the inner modules, then production crashes at runtime
      // with `Cannot find package 'strtok3'`. The same risk applies to
      // mammoth, exceljs and fflate (route-level dynamic import()s with
      // sub-deps that won't be reachable from the bundle). Keep all of
      // them external so node resolves them from node_modules normally.
      // exceljs (the xlsx replacement, post-#286) ships with its own
      // dynamic-import graph (archiver, unzipper, fast-csv, saxes, etc.)
      // that esbuild can't statically follow either.
      "file-type",
      "strtok3",
      "strtok3/*",
      "peek-readable",
      "token-types",
      "@tokenizer/inflate",
      "@tokenizer/token",
      "mammoth",
      "exceljs",
      "fflate",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    define: {
      __API_RELEASE_SHA__: JSON.stringify(releaseSha),
    },
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // Copy the migration SQL files into dist/migrations so the bundled
  // server can run pending migrations at boot in production. The
  // migrate runner is bundled into dist/index.mjs (via @workspace/db),
  // but esbuild does not bundle .sql assets — they have to be shipped
  // alongside the JS. Boot then passes `dist/migrations` as
  // `migrationsDir`. See `lib/db/src/migrate.ts` and the
  // "schema migrations run on deploy" note in `replit.md`.
  const dbMigrations = path.resolve(artifactDir, "../../lib/db/migrations");
  const distMigrations = path.resolve(distDir, "migrations");
  await cp(dbMigrations, distMigrations, { recursive: true });
  console.log("✓ Copied lib/db/migrations → dist/migrations");

  // Copy the built frontend into dist/public so the deployment is self-contained.
  // In development the cadstone vite dev server runs as its own workflow and
  // serves the SPA directly, so this copy is best-effort: we skip it when the
  // cadstone build output isn't present rather than forcing the api-server
  // dev script to run a full vite build (which used to race with
  // `check-api-codegen` writing into the generated client dirs).
  const cadstonePublic = path.resolve(artifactDir, "../cadstone/dist/public");
  const serverPublic = path.resolve(distDir, "public");
  try {
    const st = await stat(cadstonePublic);
    if (!st.isDirectory()) {
      throw new Error(`${cadstonePublic} is not a directory`);
    }
    await cp(cadstonePublic, serverPublic, { recursive: true });
    console.log("✓ Copied cadstone frontend → dist/public");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      console.log(
        `• Skipping cadstone frontend copy (not built at ${cadstonePublic}). ` +
          `Use \`pnpm --filter @workspace/cadstone run build\` to include the SPA.`,
      );
    } else {
      throw err;
    }
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
