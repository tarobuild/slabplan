import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyAccessToken } from "./auth";
import { logger } from "./logger";

let io: Server | null = null;

export function initRealtime(server: HttpServer) {
  if (io) {
    return io;
  }

  io = new Server(server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token =
      typeof socket.handshake.auth?.token === "string"
        ? socket.handshake.auth.token
        : null;

    if (!token) {
      next(new Error("Unauthorized"));
      return;
    }

    try {
      const auth = verifyAccessToken(token);
      socket.data.auth = auth;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    logger.debug(
      {
        socketId: socket.id,
        userId: socket.data.auth?.userId ?? null,
      },
      "Realtime client connected",
    );
  });

  return io;
}

export function emitRealtimeEvent(event: string, payload: unknown) {
  if (!io) {
    return;
  }

  io.emit(event, payload);
}
