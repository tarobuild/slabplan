import { Router, type IRouter } from "express";
import accountTokensRouter from "./account-tokens";
import activityRouter from "./activity";
import agentRouter from "./agent";
import authRouter from "./auth";
import clientsRouter from "./clients";
import dashboardRouter from "./dashboard";
import dailyLogAdminRouter from "./daily-log-admin";
import dailyLogsRouter from "./daily-logs";
import filesRouter from "./files";
import filesSignedRouter from "./files-signed";
import foldersRouter from "./folders";
import healthRouter from "./health";
import financialsRouter from "./financials";
import jobsRouter from "./jobs";
import leadsRouter from "./leads";
import mcpRouter from "./mcp";
import resourcesRouter from "./resources";
import scheduleRouter from "./schedule";
import searchRouter from "./search";
import usersRouter from "./users";
import { requireAuth } from "../middleware/require-auth";
import { idempotencyMiddleware } from "../middleware/idempotency";
import { captureMcpContext } from "../middleware/mcp-context";
import { fileViewErrorLogger } from "../lib/file-view-log";
import { createPerUserApiRateLimit } from "../lib/rate-limit";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
// Signed-file viewing carries its own short-lived token in the query string,
// so it must be mounted BEFORE the global Bearer-token requirement.
router.use(filesSignedRouter);
// MCP streamable-HTTP transport. Mounted BEFORE requireAuth because the
// route handles its own PAT-only auth and emits JSON-RPC-friendly errors;
// going through the regular middleware would convert auth failures into
// problem+json before the MCP transport could wrap them.
router.use(mcpRouter);
router.use(requireAuth);
// Per-identity rate limit, layered on top of the global IP-based limiter
// mounted earlier in app.ts. Authenticated users get their own dedicated
// bucket (PATs are bucketed separately from the user's interactive session)
// so a single user behind a shared NAT is no longer throttled by the
// activity of other users on the same IP. The visible `X-RateLimit-*`
// headers reflect whichever of the two limiters is currently the binding
// (stricter) constraint.
router.use(createPerUserApiRateLimit());
// Tag downstream activity rows with the calling MCP tool when present.
// Reads `X-MCP-Tool` from the request and stashes it in AsyncLocalStorage
// for `writeActivity`. No-op for non-MCP traffic.
router.use(captureMcpContext);
// Idempotency keys are scoped to the authenticated user, so the middleware
// must run AFTER requireAuth has populated req.auth.userId. This covers the
// entire authenticated /api surface (every write router below). Auth-only
// endpoints under /auth (login/logout/refresh) are intentionally not
// idempotency-cached because they have no userId to scope by until they
// have already executed.
router.use(idempotencyMiddleware());
router.use("/account/tokens", accountTokensRouter);
router.use(activityRouter);
router.use("/agent", agentRouter);
router.use(dashboardRouter);
router.use(dailyLogAdminRouter);
router.use(dailyLogsRouter);
router.use(filesRouter);
router.use(foldersRouter);
router.use(resourcesRouter);
router.use(searchRouter);
router.use(scheduleRouter);
router.use("/users", usersRouter);
router.use("/jobs", jobsRouter);
router.use("/jobs", financialsRouter);
router.use("/leads", leadsRouter);
router.use("/clients", clientsRouter);

// Catch errors propagating from any of the routes above (including the
// pre-route `requireAuth` rejection) and emit a structured `view.fail`
// for the four file-view paths so an operator can debug "user can't
// open the file" reports the same way they grep for `upload.fail`.
// `withFileViewLogging` marks the request so route-level failures it
// already logged are not double-counted here.
router.use(fileViewErrorLogger);

export default router;
