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

    let aborted = false;
    req.on("close", () => {
      aborted = true;
    });

    try {
      await runAgentTurn({
        userId,
        bearerToken,
        baseUrl,
        history,
        userMessage: body.content,
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
      if (!aborted) {
        res.end();
      }
    }
  }),
);

export default router;
