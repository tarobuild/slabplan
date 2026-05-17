import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { ACCESS_TOKEN_TTL_SECONDS, verifyAccessToken } from "./auth";
import { assertActiveAuthUser } from "./active-user";
import { attachOrganizationContext } from "./auth-organization";
import { redactRealtimePayloadForAuth } from "./activity-visibility";
import {
  isAdmin,
  listAccessibleJobIds,
  listAccessibleLeadIds,
} from "./authorization";
import { corsOrigin } from "./cors";
import { logger } from "./logger";

let io: Server | null = null;
const adminRoom = "__stone_track_admins__";
const REALTIME_TOKEN_REVALIDATION_INTERVAL_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;

async function listRealtimeScopeIds(auth: NonNullable<Express.Request["auth"]>) {
  if (isAdmin(auth)) {
    return null;
  }

  const [jobIds, leadIds] = await Promise.all([
    listAccessibleJobIds(auth),
    listAccessibleLeadIds(auth),
  ]);

  return Array.from(new Set([...(jobIds ?? []), ...(leadIds ?? [])]));
}

export function initRealtime(server: HttpServer) {
  if (io) {
    return io;
  }

  io = new Server(server, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    Promise.resolve()
      .then(async () => {
        const token =
          typeof socket.handshake.auth?.token === "string"
            ? socket.handshake.auth.token
            : null;

        if (!token) {
          throw new Error("Unauthorized");
        }

        const auth = verifyAccessToken(token);
        await assertActiveAuthUser(auth);
        socket.data.auth = await attachOrganizationContext(auth);
        socket.data.accessToken = token;
        socket.data.scopeIds = await listRealtimeScopeIds(socket.data.auth);
      })
      .then(() => next())
      .catch(() => next(new Error("Unauthorized")));
  });

  io.on("connection", (socket) => {
    const revalidateAccessToken = async () => {
      const token = typeof socket.data.accessToken === "string" ? socket.data.accessToken : null;

      if (!token) {
        logger.info({ socketId: socket.id }, "Disconnecting realtime client without an access token");
        socket.disconnect(true);
        return false;
      }

      try {
        const auth = verifyAccessToken(token);
        await assertActiveAuthUser(auth);
        socket.data.auth = await attachOrganizationContext(auth);
        socket.data.scopeIds = await listRealtimeScopeIds(socket.data.auth);
        return true;
      } catch (error) {
        logger.info(
          {
            err: error,
            socketId: socket.id,
            userId: socket.data.auth?.userId ?? null,
          },
          "Disconnecting realtime client with an expired or invalid token",
        );
        socket.disconnect(true);
        return false;
      }
    };

    void (async () => {
      if (!(await revalidateAccessToken())) {
        return;
      }

      const tokenRevalidationTimer = setInterval(() => {
        void revalidateAccessToken();
      }, REALTIME_TOKEN_REVALIDATION_INTERVAL_MS);

      socket.once("disconnect", () => {
        clearInterval(tokenRevalidationTimer);
      });

      const scopeIds = Array.isArray(socket.data.scopeIds)
        ? socket.data.scopeIds.filter((scopeId: unknown): scopeId is string => typeof scopeId === "string")
        : [];

      if (isAdmin(socket.data.auth)) {
        void socket.join(adminRoom);
      }

      if (scopeIds.length > 0) {
        void socket.join(scopeIds);
      }

      const requestedScopeId =
        typeof socket.handshake.auth?.jobId === "string"
          ? socket.handshake.auth.jobId
          : null;

      if (requestedScopeId && scopeIds.includes(requestedScopeId)) {
        void socket.join(requestedScopeId);
      }

      logger.debug(
        {
          socketId: socket.id,
          userId: socket.data.auth?.userId ?? null,
          scopeCount: scopeIds.length,
        },
        "Realtime client connected",
      );
    })();
  });

  return io;
}

export function emitRealtimeEvent(event: string, payload: unknown, scopeId?: string | null) {
  if (!io) {
    return;
  }

  if (event === "activity:created" || event === "file:uploaded") {
    void emitRealtimeEventForAuthorizedSockets(event, payload, scopeId ?? null);
    return;
  }

  if (scopeId) {
    io.to(scopeId).emit(event, payload);
    io.to(adminRoom).emit(event, payload);
    return;
  }

  io.to(adminRoom).emit(event, payload);
}

async function emitRealtimeEventForAuthorizedSockets(
  event: string,
  payload: unknown,
  scopeId: string | null,
) {
  if (!io) {
    return;
  }

  try {
    const room = scopeId ? [scopeId, adminRoom] : [adminRoom];
    const sockets = await io.in(room).fetchSockets();
    const seenSocketIds = new Set<string>();

    await Promise.all(
      sockets.map(async (socket) => {
        if (seenSocketIds.has(socket.id)) {
          return;
        }
        seenSocketIds.add(socket.id);

        const auth = socket.data.auth;
        if (!auth) {
          return;
        }

        const redactedPayload = await redactRealtimePayloadForAuth(event, payload, auth);
        if (redactedPayload !== null) {
          socket.emit(event, redactedPayload);
        }
      }),
    );
  } catch (error) {
    logger.warn({ err: error, event, scopeId }, "Failed to emit redacted realtime event");
  }
}
