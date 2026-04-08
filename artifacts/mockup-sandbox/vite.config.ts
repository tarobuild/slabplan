import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const port = Number(process.env.PORT ?? "5173");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

function buildChunkName(id: string) {
  const normalized = id.split(path.sep).join("/");

  if (!normalized.includes("/node_modules/")) {
    return null;
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
    return "react-vendor";
  }

  if (normalized.includes("/@radix-ui/")) {
    return "radix-vendor";
  }

  if (normalized.includes("/@tiptap/")) {
    return "tiptap-vendor";
  }

  if (
    normalized.includes("/recharts/")
    || normalized.includes("/frappe-gantt/")
    || normalized.includes("/react-big-calendar/")
  ) {
    return "visualization-vendor";
  }

  if (
    normalized.includes("/date-fns/")
    || normalized.includes("/react-day-picker/")
  ) {
    return "date-vendor";
  }

  if (normalized.includes("/lucide-react/")) {
    return "icons-vendor";
  }

  if (
    normalized.includes("/cmdk/")
    || normalized.includes("/detect-node-es/")
    || normalized.includes("/embla-carousel-react/")
    || normalized.includes("/react-resizable-panels/")
    || normalized.includes("/vaul/")
    || normalized.includes("/socket.io-client/")
  ) {
    return "ui-vendor";
  }

  const packagePath = normalized.split("/node_modules/").at(-1) ?? "";
  const segments = packagePath.split("/");
  const packageName = segments[0]?.startsWith("@")
    ? `${segments[0]}/${segments[1]}`
    : segments[0];

  return packageName
    ? `vendor-${packageName.replace(/^@/, "").replace(/[/.]/g, "-")}`
    : "vendor";
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return buildChunkName(id);
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target:
          process.env.API_PROXY_TARGET ??
          process.env.VITE_API_PROXY_TARGET ??
          "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/socket.io": {
        target:
          process.env.API_PROXY_TARGET ??
          process.env.VITE_API_PROXY_TARGET ??
          "http://127.0.0.1:3000",
        changeOrigin: true,
        ws: true,
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
});
