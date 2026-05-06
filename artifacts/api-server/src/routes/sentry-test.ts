// Hidden diagnostic endpoint to fire a test exception into Sentry.
// Only reachable when SENTRY_TEST_TOKEN is configured (and matches the
// `?token=` query param) — keeps it inert in production unless a
// developer deliberately enables it.

import { Router, type IRouter } from "express";
import { asyncHandler, HttpError } from "../lib/http";
import { Sentry, isSentryInitialized } from "../lib/sentry";

const router: IRouter = Router();

router.post(
  "/_sentry-test",
  asyncHandler(async (req, res) => {
    const expected = process.env.SENTRY_TEST_TOKEN?.trim();
    const provided = typeof req.query.token === "string" ? req.query.token : "";
    if (!expected || expected !== provided) {
      throw new HttpError(404, "Not found.", undefined, "not-found");
    }
    if (!isSentryInitialized()) {
      throw new HttpError(
        503,
        "Sentry is not initialized in this environment.",
        undefined,
        "service-unavailable",
      );
    }
    const id = Sentry.captureException(
      new Error("Cadstone API Sentry smoke test (Task #348)"),
      { tags: { smoke: "true" } },
    );
    await Sentry.flush(2000);
    res.status(200).json({ ok: true, eventId: id ?? null });
  }),
);

export default router;
