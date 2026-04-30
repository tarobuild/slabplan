import { Router, type IRouter } from "express";
import { HealthGetHealthzResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthGetHealthzResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
