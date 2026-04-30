import { promises as fs } from "node:fs";
import path from "node:path";
import { Router, type IRouter, type Request } from "express";
import YAML from "yaml";
import { logger } from "../lib/logger";

const router: IRouter = Router();

let cachedSpec: unknown | null = null;
let cachedSpecPromise: Promise<unknown> | null = null;

async function loadSpec(): Promise<unknown> {
  if (cachedSpec !== null) return cachedSpec;
  if (cachedSpecPromise) return cachedSpecPromise;

  cachedSpecPromise = (async () => {
    // The bundler emits a `lib` directory next to the server bundle when
    // running under esbuild, but during raw `tsx` dev mode we live inside
    // `artifacts/api-server/src`. Try a few candidate paths so this works in
    // both cases without requiring a build-time copy.
    const candidates = [
      path.resolve(process.cwd(), "../../lib/api-spec/openapi.yaml"),
      path.resolve(process.cwd(), "lib/api-spec/openapi.yaml"),
      path.resolve(process.cwd(), "../api-spec/openapi.yaml"),
    ];

    for (const candidate of candidates) {
      try {
        const raw = await fs.readFile(candidate, "utf8");
        // openapi.yaml is true YAML, not JSON. Parse with `yaml` so the
        // public /openapi.json endpoint can serialize it as JSON for AI
        // clients.
        const parsed = YAML.parse(raw);
        cachedSpec = parsed;
        return parsed;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.warn({ err, candidate }, "failed to load openapi spec candidate");
        }
      }
    }

    throw new Error("Unable to locate openapi.yaml on disk.");
  })();

  try {
    return await cachedSpecPromise;
  } finally {
    cachedSpecPromise = null;
  }
}

function origin(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  const host = req.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

router.get("/openapi.json", async (req, res, next) => {
  try {
    const spec = await loadSpec();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json({
      ...(spec as object),
      // Substitute a fully-qualified server URL so MCP/AI clients can use the
      // spec without needing to know our deployment host out of band.
      servers: [{ url: `${origin(req)}/api`, description: "Live API" }],
    });
  } catch (err) {
    next(err);
  }
});

router.get("/.well-known/ai-plugin.json", (req, res) => {
  const base = origin(req);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    schema_version: "v1",
    name_for_human: "CAD Stone Networks",
    name_for_model: "cadstone",
    description_for_human:
      "Manage clients, jobs, leads, schedule, daily logs, and files for CAD Stone Networks.",
    description_for_model:
      "Programmatic access to the CAD Stone Networks platform for AI agents. Authenticate using a personal access token (Bearer cs_pat_…). Tokens are issued from the user settings page. All endpoints accept and return JSON. Errors follow RFC 7807 (application/problem+json). Long lists support both page-based (page,pageSize) and cursor-based (cursor,limit) pagination. Supply Idempotency-Key on POST/PUT/PATCH/DELETE to safely retry. Rate limits are signaled via X-RateLimit-* response headers and Retry-After on 429.",
    auth: {
      type: "user_http",
      authorization_type: "bearer",
      // Where the user can mint a personal access token. AI clients should
      // surface this URL so the human-in-the-loop can grant programmatic
      // access without leaving the chat surface.
      auth_info_url: `${base}/settings`,
    },
    api: {
      type: "openapi",
      url: `${base}/openapi.json`,
    },
    // MCP (Model Context Protocol) streamable-HTTP transport endpoint.
    // Use a `cs_pat_…` Personal Access Token in the `Authorization: Bearer`
    // header. POST JSON-RPC 2.0 messages; the server responds with either a
    // direct JSON body or an SSE stream depending on the request kind. See
    // replit.md → "MCP server (Task #108)" for client examples.
    mcp_server_url: `${base}/api/mcp`,
    logo_url: `${base}/favicon.ico`,
    contact_email: "support@cadstonesystems.com",
    legal_info_url: `${base}/`,
  });
});

export default router;
