import { Router, type IRouter } from "express";
import activityRouter from "./activity";
import authRouter from "./auth";
import filesRouter from "./files";
import foldersRouter from "./folders";
import healthRouter from "./health";
import jobsRouter from "./jobs";
import leadsRouter from "./leads";
import usersRouter from "./users";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use(requireAuth);
router.use(activityRouter);
router.use(filesRouter);
router.use(foldersRouter);
router.use("/users", usersRouter);
router.use("/jobs", jobsRouter);
router.use("/leads", leadsRouter);

export default router;
