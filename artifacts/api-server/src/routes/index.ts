import { Router, type IRouter } from "express";
import accountTokensRouter from "./account-tokens";
import activityRouter from "./activity";
import authRouter from "./auth";
import clientsRouter from "./clients";
import dashboardRouter from "./dashboard";
import dailyLogAdminRouter from "./daily-log-admin";
import dailyLogsRouter from "./daily-logs";
import filesRouter from "./files";
import filesSignedRouter from "./files-signed";
import foldersRouter from "./folders";
import healthRouter from "./health";
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
router.use("/leads", leadsRouter);
router.use("/clients", clientsRouter);

export default router;
