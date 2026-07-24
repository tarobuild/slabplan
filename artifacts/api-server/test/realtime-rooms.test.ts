import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "../src/lib/authorization.ts";
import { reconcileRealtimeRooms } from "../src/lib/realtime.ts";

const ADMIN_ROOM = "__stone_track_admins__";

class FakeSocket {
  id = "socket-1";
  rooms = new Set<string>([this.id]);
  data: { auth?: AuthContext; scopeIds?: string[] | null } = {};

  async join(rooms: string | string[]) {
    for (const room of Array.isArray(rooms) ? rooms : [rooms]) {
      this.rooms.add(room);
    }
  }

  async leave(room: string) {
    this.rooms.delete(room);
  }
}

function auth(role: AuthContext["role"]): AuthContext {
  return {
    userId: "user-1",
    email: "user@example.com",
    role,
    type: "access",
  };
}

test("reconcileRealtimeRooms leaves revoked scope rooms and joins new ones", async () => {
  const socket = new FakeSocket();
  socket.data.scopeIds = ["job-1", "lead-1"];
  socket.rooms.add("job-1");
  socket.rooms.add("lead-1");
  socket.rooms.add(ADMIN_ROOM);

  await reconcileRealtimeRooms(socket, auth("crew_member"), ["lead-1", "job-2"]);

  assert.deepEqual(socket.data.scopeIds, ["lead-1", "job-2"]);
  assert.equal(socket.rooms.has(socket.id), true);
  assert.equal(socket.rooms.has("job-1"), false);
  assert.equal(socket.rooms.has("lead-1"), true);
  assert.equal(socket.rooms.has("job-2"), true);
  assert.equal(socket.rooms.has(ADMIN_ROOM), false);
});

test("reconcileRealtimeRooms preserves admin-room semantics", async () => {
  const socket = new FakeSocket();
  socket.data.scopeIds = ["job-1"];
  socket.rooms.add("job-1");

  await reconcileRealtimeRooms(socket, auth("admin"), null);

  assert.equal(socket.rooms.has(socket.id), true);
  assert.equal(socket.rooms.has("job-1"), false);
  assert.equal(socket.rooms.has(ADMIN_ROOM), true);
  assert.equal(socket.data.scopeIds, null);
});
