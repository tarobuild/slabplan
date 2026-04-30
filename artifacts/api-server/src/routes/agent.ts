import { Router, type IRouter } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  agentConversations,
  agentMessages,
  type AgentCitation,
  type AgentToolCall,
} from "@workspace/db/schema";
import { HttpError, asyncHandler } from "../lib/http";
import { readBearerToken } from "../middleware/require-auth";
import { runAgentTurn, writeSse } from "../lib/agent/orchestrator";
import { loadUsageSnapshot } from "../lib/agent/usage";
import {
  maxInFlightPerUser,
  releaseSlot,
  tryAcquireSlot,
} from "../lib/agent/inflight";
import { createRateLimit } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const conversationIdParam = z.object({
  id: z.string().uuid(),
});

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  initialMessage: z.string().trim().min(1).max(8000).optional(),
});

const patchConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.pinned !== undefined, {
    message: "At least one of `title` or `pinned` is required.",
  });

const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(8000),
});

// Per-user agent-message rate limit. Layered ON TOP of the general per-user
// API limiter (which already runs in routes/index.ts) because one assistant
// turn fans out into a long-running Anthropic stream + several MCP tool
// calls — generic per-request budgets can't see that cost asymmetry. Picked
// to be generous enough for normal use (a heavy back-and-forth is a few
// turns per minute, tops) while still capping a scripted-spam scenario at
// roughly one turn every ~3 seconds. Configurable via env so production can
// tune without a deploy.
function agentSendQuota(): number {
  const raw = process.env.AGENT_RATE_LIMIT_PER_MIN;
  if (!raw) return 20;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return 20;
  return n;
}

const agentSendRateLimit = createRateLimit({
  keyPrefix: "perUser:agent:send",
  max: agentSendQuota(),
  windowMs: 60_000,
  message:
    "You're sending messages to the assistant too quickly. Please wait a moment and try again.",
  resolveKey: (req) => {
    const userId = req.auth?.userId;
    return userId ? `u:${userId}` : null;
  },
});

async function loadOwnedConversation(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(agentConversations)
    .where(
      and(eq(agentConversations.id, id), eq(agentConversations.userId, userId)),
    )
    .limit(1);
  if (!row) {
    throw new HttpError(404, "Conversation not found.", undefined, "not-found");
  }
  return row;
}

router.get(
  "/usage",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const snapshot = await loadUsageSnapshot(userId);
    res.json(snapshot);
  }),
);

router.get(
  "/conversations",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const rows = await db
      .select()
      .from(agentConversations)
      .where(eq(agentConversations.userId, userId))
      .orderBy(desc(agentConversations.pinned), desc(agentConversations.lastMessageAt))
      .limit(100);
    res.json({ conversations: rows });
  }),
);

router.post(
  "/conversations",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const body = createConversationSchema.parse(req.body ?? {});
    const title = body.title ?? "New conversation";
    const [row] = await db
      .insert(agentConversations)
      .values({ userId, title })
      .returning();
    res.status(201).json({ conversation: row });
  }),
);

router.patch(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const { id } = conversationIdParam.parse(req.params);
    const body = patchConversationSchema.parse(req.body ?? {});
    await loadOwnedConversation(userId, id);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) updates.title = body.title;
    if (body.pinned !== undefined) updates.pinned = body.pinned;

    const [row] = await db
      .update(agentConversations)
      .set(updates)
      .where(eq(agentConversations.id, id))
      .returning();
    res.json({ conversation: row });
  }),
);

router.delete(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const { id } = conversationIdParam.parse(req.params);
    await loadOwnedConversation(userId, id);
    await db.delete(agentConversations).where(eq(agentConversations.id, id));
    res.status(204).end();
  }),
);

router.get(
  "/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const { id } = conversationIdParam.parse(req.params);
    await loadOwnedConversation(userId, id);
    const rows = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.conversationId, id))
      .orderBy(asc(agentMessages.createdAt))
      .limit(500);
    res.json({ messages: rows });
  }),
);

router.post(
  "/conversations/:id/messages",
  agentSendRateLimit,
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const { id } = conversationIdParam.parse(req.params);
    const body = sendMessageSchema.parse(req.body ?? {});
    const conversation = await loadOwnedConversation(userId, id);

    // Token cap check.
    const usage = await loadUsageSnapshot(userId);
    if (usage.exceeded) {
      throw new HttpError(
        429,
        `You've reached your monthly assistant usage limit (${usage.cap.toLocaleString()} tokens). It resets on the 1st.`,
        undefined,
        "usage-limit",
      );
    }

    // In-flight concurrency cap. Spamming Send before a previous turn
    // finishes would otherwise fan out N concurrent Anthropic streams
    // against the monthly cap; reject the second send with a 429 so the
    // UI can disable the button until the current turn completes.
    if (!tryAcquireSlot(userId)) {
      throw new HttpError(
        429,
        `You already have an assistant reply in progress. Please wait for it to finish before sending another message (limit: ${maxInFlightPerUser()}).`,
        undefined,
        "in-flight-limit",
      );
    }

    // Single try/finally guarantees the slot is released exactly once for
    // every code path after a successful acquire — including DB failures
    // during the auto-title update or history load (which sit BETWEEN
    // acquire and `runAgentTurn`'s own try block). Without this wrapper a
    // transient DB error after acquire would leak the slot and the user
    // would be stuck at the cap until process restart.
    try {
      const bearerToken = readBearerToken(req);
      if (!bearerToken) {
        throw new HttpError(401, "Authentication required.", undefined, "unauthorized");
      }

      // Persist the user message immediately so it's visible if the request fails.
      const [userMsg] = await db
        .insert(agentMessages)
        .values({
          conversationId: id,
          role: "user",
          content: body.content,
        })
        .returning();

      // Auto-title on first user message if still default.
      if (conversation.title === "New conversation") {
        const newTitle = body.content.slice(0, 80).replace(/\s+/g, " ").trim();
        if (newTitle.length > 0) {
          await db
            .update(agentConversations)
            .set({ title: newTitle, updatedAt: new Date() })
            .where(eq(agentConversations.id, id));
        }
      }

      // Load history (excluding the message we just inserted, since the
      // orchestrator appends it explicitly as the trailing user turn).
      const historyRows = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.conversationId, id))
        .orderBy(asc(agentMessages.createdAt))
        .limit(500);
      const history = historyRows.filter((m) => m.id !== userMsg!.id);

      // Begin SSE response.
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      writeSse(res, {
        type: "status",
        text: "Sending to assistant…",
      });

      // Initial event includes the persisted user message so the client can
      // reconcile its optimistic placeholder.
      res.write(
        `event: user_message\ndata: ${JSON.stringify({ message: userMsg })}\n\n`,
      );

      const port = process.env.PORT ?? "8080";
      const baseUrl = `http://127.0.0.1:${port}`;

      // When the SSE consumer drops mid-turn (closed tab, navigation,
      // explicit Stop button), abort the controller. The signal propagates
      // into the Anthropic SDK and into every MCP tool fetch via ApiClient,
      // which makes the orchestrator unwind within ~1s instead of running
      // to completion against a client that's no longer listening.
      const abortController = new AbortController();
      let aborted = false;
      const onClose = () => {
        aborted = true;
        if (!abortController.signal.aborted) abortController.abort();
      };
      req.on("close", onClose);

      try {
        await runAgentTurn({
          userId,
          bearerToken,
          baseUrl,
          history,
          userMessage: body.content,
          signal: abortController.signal,
          emit: (event) => {
            if (aborted) return;
            writeSse(res, event);
          },
          saveAssistantMessage: async ({
            text,
            toolCalls,
            citations,
            inputTokens,
            outputTokens,
            stoppedReason,
          }) => {
            const [row] = await db
              .insert(agentMessages)
              .values({
                conversationId: id,
                role: "assistant",
                content: text,
                toolCalls: toolCalls.length > 0 ? (toolCalls as AgentToolCall[]) : null,
                citations:
                  citations.length > 0 ? (citations as AgentCitation[]) : null,
                inputTokens,
                outputTokens,
                stoppedReason,
              })
              .returning();
            await db
              .update(agentConversations)
              .set({ lastMessageAt: new Date(), updatedAt: new Date() })
              .where(eq(agentConversations.id, id));
            return { id: row!.id };
          },
        });
      } catch (err) {
        logger.error({ err }, "Agent: orchestrator failed");
        if (!aborted) {
          writeSse(res, {
            type: "error",
            message: err instanceof Error ? err.message : "Assistant turn failed.",
          });
        }
      } finally {
        req.off("close", onClose);
        if (!aborted) {
          res.end();
        }
      }
    } finally {
      releaseSlot(userId);
    }
  }),
);

export default router;
