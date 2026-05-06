import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"
import { rm } from "node:fs/promises"
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal"
import { sentryVitePlugin } from "@sentry/vite-plugin"

const rawPort = process.env.PORT ?? "21903"
const port = Number(rawPort)

if (Number.isNaN(port) || !Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`)
}

const basePath = process.env.BASE_PATH ?? "/"

function buildChunkName(id: string) {
  const normalized = id.split(path.sep).join("/")

  if (!normalized.includes("/node_modules/")) {
    return null
  }

  if (
    normalized.includes("/react/")
    || normalized.includes("/react-dom/")
    || normalized.includes("/react-router/")
    || normalized.includes("/react-router-dom/")
    || normalized.includes("/scheduler/")
    || normalized.includes("/@remix-run/router/")
    || normalized.includes("/use-sync-external-store/")
  ) {
    return "react-vendor"
  }

  if (normalized.includes("/@radix-ui/")) {
    return "radix-vendor"
  }

  if (
    normalized.includes("/date-fns/")
    || normalized.includes("/react-day-picker/")
  ) {
    return "date-vendor"
  }

  if (normalized.includes("/lucide-react/")) {
    return "icons-vendor"
  }

  if (
    normalized.includes("/cmdk/")
    || normalized.includes("/detect-node-es/")
    || normalized.includes("/embla-carousel-react/")
    || normalized.includes("/react-resizable-panels/")
    || normalized.includes("/vaul/")
  ) {
    return "ui-vendor"
  }

  const packagePath = normalized.split("/node_modules/").at(-1) ?? ""
  const segments = packagePath.split("/")
  const packageName = segments[0]?.startsWith("@")
    ? `${segments[0]}/${segments[1]}`
    : segments[0]

  return packageName
    ? `vendor-${packageName.replace(/^@/, "").replace(/[/.]/g, "-")}`
    : "vendor"
}

// Build-time guard for Task #302 / #315: assert that pdfjs-dist and react-pdf
// never re-enter the dashboard's eager bundle. PdfViewer is loaded via
// React.lazy() from FilePreview.tsx, so the only way these libraries can ship
// in the eager graph is if someone introduces a static `import` of them from
// a module reachable from the entry without crossing a dynamic-import
// boundary. This plugin walks the static-import closure of each entry chunk
// and fails the build if any chunk in that closure includes modules from
// `pdfjs-dist` or `react-pdf`.
// Strip generated source maps from the dist output after Sentry has
// uploaded them, so end users can't fetch *.js.map from the published
// bundle. Runs as the final `closeBundle` step.
function deleteSourceMapsAfterUpload(): Plugin {
  return {
    name: "delete-source-maps-after-upload",
    apply: "build",
    enforce: "post",
    async closeBundle() {
      const outDir = path.resolve(import.meta.dirname, "dist/public/assets")
      try {
        const fs = await import("node:fs/promises")
        const entries = await fs.readdir(outDir).catch(() => [] as string[])
        await Promise.all(
          entries
            .filter((name) => name.endsWith(".map"))
            .map((name) => rm(path.join(outDir, name), { force: true })),
        )
      } catch {
        // Best effort — never fail the build over cleanup.
      }
    },
  }
}

function assertNoEagerPdfBundles(): Plugin {
  const FORBIDDEN_PATTERNS = [
    { label: "pdfjs-dist", regex: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?pdfjs-dist[\\/]/ },
    { label: "react-pdf", regex: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?react-pdf[\\/]/ },
  ]

  return {
    name: "assert-no-eager-pdf-bundles",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = new Map<string, { imports: string[]; modules: string[] }>()
      const entries: string[] = []

      for (const [fileName, asset] of Object.entries(bundle)) {
        if (asset.type !== "chunk") continue
        chunks.set(fileName, {
          imports: asset.imports,
          modules: Object.keys(asset.modules ?? {}),
        })
        if (asset.isEntry) entries.push(fileName)
      }

      const eager = new Set<string>()
      const queue = [...entries]
      while (queue.length > 0) {
        const next = queue.shift()!
        if (eager.has(next)) continue
        eager.add(next)
        const chunk = chunks.get(next)
        if (!chunk) continue
        for (const imp of chunk.imports) queue.push(imp)
      }

      const violations: string[] = []
      for (const fileName of eager) {
        const chunk = chunks.get(fileName)
        if (!chunk) continue
        for (const moduleId of chunk.modules) {
          for (const { label, regex } of FORBIDDEN_PATTERNS) {
            if (regex.test(moduleId)) {
              violations.push(`  - ${label} module "${moduleId}" landed in eager chunk "${fileName}"`)
            }
          }
        }
      }

      if (violations.length > 0) {
        const message = [
          "Eager-bundle regression detected: pdfjs-dist / react-pdf must stay behind a dynamic import().",
          "",
          ...violations,
          "",
          "PdfViewer is loaded via React.lazy() from FilePreview.tsx. If you need a PDF",
          "feature elsewhere, route it through that lazy boundary instead of importing",
          "react-pdf or pdfjs-dist statically. See the comment in vite.config.ts and",
          "the original baseline established in Task #302.",
        ].join("\n")
        this.error(message)
      }
    },
  }
}

export default defineConfig(async ({ mode }) => {
const willUploadSourceMaps =
  mode === "production"
  && Boolean(process.env.SENTRY_AUTH_TOKEN)
  && Boolean(process.env.SENTRY_ORG)
  && Boolean(process.env.SENTRY_PROJECT_WEB)

// Task #348 — single source of truth for the release tag, shared
// between (a) the runtime web Sentry SDK init, (b) the
// sentryVitePlugin source-map upload, and (c) the API server (which
// derives the same 12-char short SHA from REPLIT_GIT_COMMIT_SHA in
// artifacts/api-server/src/lib/sentry.ts). Keeping the value
// identical end-to-end is what makes "errors filed against this
// release" queries in Sentry actually correlate web events, server
// events, and uploaded source maps.
const fullReleaseSha =
  process.env.VITE_RELEASE_SHA
  ?? process.env.REPLIT_GIT_COMMIT_SHA
  ?? process.env.GIT_COMMIT
  ?? process.env.RELEASE_SHA
  ?? ""
const releaseSha = fullReleaseSha ? fullReleaseSha.slice(0, 12) : ""

return ({
  base: basePath,
  // IMPORTANT (Task #348 — security): do NOT add `SENTRY_` to
  // envPrefix. That would expose every SENTRY_* process env var
  // (including SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT_WEB
  // used by the source-map upload below) to `import.meta.env` in
  // the client bundle. We instead inject the two values the
  // browser is actually allowed to see — the public DSN and the
  // release tag — via `define` and read them as
  // `__SENTRY_DSN_WEB__` / `__SENTRY_RELEASE__` from
  // src/lib/sentry.ts.
  define: {
    __SENTRY_DSN_WEB__: JSON.stringify(
      process.env.SENTRY_DSN_WEB ?? process.env.VITE_SENTRY_DSN ?? "",
    ),
    __SENTRY_RELEASE__: JSON.stringify(releaseSha),
    __SENTRY_ENVIRONMENT__: JSON.stringify(
      process.env.SENTRY_ENVIRONMENT
      ?? process.env.VITE_SENTRY_ENVIRONMENT
      ?? "",
    ),
  },
  plugins: [
    react(),
    tailwindcss(),
    assertNoEagerPdfBundles(),
    // Source-map upload runs only in production builds when both an
    // auth token and an org/project pair are present. In all other
    // builds the plugin is a no-op so dev / typecheck / CI without
    // Sentry credentials remain unaffected. Maps are deleted from the
    // dist after upload by `deleteSourceMapsAfterUpload()` below so
    // end users can't fetch them.
    ...(willUploadSourceMaps
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT_WEB,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: {
              // Same shared 12-char SHA the runtime SDK reads from
              // __SENTRY_RELEASE__ — keeps web events / server
              // events / uploaded source maps on a single release.
              name: releaseSha || undefined,
            },
            sourcemaps: {
              filesToDeleteAfterUpload: ["dist/public/assets/*.map"],
            },
            telemetry: false,
          }),
          deleteSourceMapsAfterUpload(),
        ]
      : []),
    ...(mode === "development" ? [runtimeErrorOverlay()] : []),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    // Initial-payload baseline (Task #302):
    //   pdfjs-dist + react-pdf (~500 KB) are now lazy-loaded behind
    //   `React.lazy(() => import("./PdfViewer"))` in
    //   src/components/files/FilePreview.tsx, so they no longer ship
    //   in the eager bundle. The PDF chunk is fetched on demand the
    //   first time a user previews a PDF. If you re-introduce a static
    //   import of `react-pdf` or `pdfjs-dist` from any module in the
    //   eager graph, the dashboard's first paint will regress by the
    //   same ~500 KB — keep PDF code behind dynamic `import()`.
    //
    //   This invariant is enforced automatically by the
    //   `assertNoEagerPdfBundles()` plugin above, which fails the build
    //   (and the `check-eager-bundle` validation workflow) the moment a
    //   regression lands. See Task #315.
    //
    // Initial-payload baseline (Task #313 / #316):
    //   recharts, frappe-gantt, react-big-calendar, and @tiptap/* were
    //   confirmed in Task #313 to have no callers in
    //   artifacts/cadstone/src and were fully removed from
    //   package.json's dependencies in Task #316 (along with the
    //   unreferenced src/components/ui/chart.tsx shadcn wrapper around
    //   recharts). The corresponding "visualization-vendor" and
    //   "tiptap-vendor" manualChunks entries were dropped at the same
    //   time since the libs themselves are gone. If you need a chart,
    //   gantt, calendar, or rich-text editor in the dashboard, prefer
    //   re-introducing them behind a `React.lazy(() => import(...))`
    //   + <Suspense> boundary the same way PdfViewer is wrapped in
    //   src/components/files/FilePreview.tsx, so the dashboard's first
    //   paint stays small.
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
    // Source maps are emitted ONLY when the Sentry upload pipeline is
    // configured (auth token + org + project all set). They're then
    // uploaded to Sentry and deleted from the dist by both the Sentry
    // plugin itself (`sourcemaps.filesToDeleteAfterUpload`) and the
    // belt-and-braces `deleteSourceMapsAfterUpload()` plugin above, so
    // they never ship to end users in the published bundle. When the
    // upload pipeline isn't configured we leave sourcemaps off entirely
    // — never ship raw maps to production users.
    sourcemap: willUploadSourceMaps,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return buildChunkName(id)
        },
        chunkFileNames: "assets/[hash].js",
        assetFileNames: "assets/[hash][extname]",
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
})
})
