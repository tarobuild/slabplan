import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { personalAccessTokens } from "@workspace/db/schema";
import { HttpError, asyncHandler } from "../lib/http";
import {
  generateRawToken,
  listPersonalAccessTokens,
  revokeToken,
  PAT_SCOPES,
} from "../lib/personal-access-tokens";

const router: IRouter = Router();

const createPatSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  scope: z.enum(PAT_SCOPES).optional().default("read_write"),
  expiresAt: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        throw new HttpError(400, "expiresAt must be a valid ISO timestamp.", undefined, "validation");
      }
      return parsed;
    })
    .refine(
      (value) => value === null || value.getTime() > Date.now(),
      { message: "expiresAt must be in the future." },
    ),
});

function serializePat(row: Awaited<ReturnType<typeof listPersonalAccessTokens>>[number]) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    tokenPrefix: row.tokenPrefix,
    lastFour: row.lastFour,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const rows = await listPersonalAccessTokens(userId);
    res.json({ tokens: rows.map(serializePat) });
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;

    // PATs cannot mint other PATs — only an interactive session can.
    if (req.auth?.patId) {
      throw new HttpError(
        403,
        "Personal access tokens cannot create other tokens.",
        undefined,
        "forbidden",
      );
    }

    const parsed = createPatSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, "Invalid token payload.", parsed.error.flatten(), "validation");
    }

    const { name, scope, expiresAt } = parsed.data;
    const generated = generateRawToken();

    const [row] = await db
      .insert(personalAccessTokens)
      .values({
        userId,
        name,
        scope,
        tokenHash: generated.tokenHash,
        tokenPrefix: generated.prefix,
        lastFour: generated.lastFour,
        expiresAt,
      })
      .returning({
        id: personalAccessTokens.id,
        userId: personalAccessTokens.userId,
        name: personalAccessTokens.name,
        scope: personalAccessTokens.scope,
        tokenPrefix: personalAccessTokens.tokenPrefix,
        lastFour: personalAccessTokens.lastFour,
        expiresAt: personalAccessTokens.expiresAt,
        lastUsedAt: personalAccessTokens.lastUsedAt,
        revokedAt: personalAccessTokens.revokedAt,
        createdAt: personalAccessTokens.createdAt,
      });

    if (!row) {
      throw new HttpError(500, "Failed to create token.");
    }

    res.status(201).json({
      token: serializePat(row),
      // The full secret is shown exactly once. The frontend must surface it,
      // and we never store it in plaintext.
      secret: generated.secret,
    });
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const tokenId = String(req.params.id ?? "").trim();

    if (!tokenId) {
      throw new HttpError(400, "Token id is required.", undefined, "validation");
    }

    const ok = await revokeToken(userId, tokenId);
    if (!ok) {
      throw new HttpError(404, "Token not found.", undefined, "not-found");
    }

    res.status(204).end();
  }),
);

export default router;
