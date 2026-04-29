import { Router, type IRouter } from "express";
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
import resourcesRouter from "./resources";
import scheduleRouter from "./schedule";
import searchRouter from "./search";
import usersRouter from "./users";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
// Signed-file viewing carries its own short-lived token in the query string,
// so it must be mounted BEFORE the global Bearer-token requirement.
router.use(filesSignedRouter);
router.use(requireAuth);
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
