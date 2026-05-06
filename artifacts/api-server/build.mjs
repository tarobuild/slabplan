import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { cp, rm, stat } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
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
