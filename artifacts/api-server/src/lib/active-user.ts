import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { HttpError } from "./http";

export async function assertActiveUserById(userId: string) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    throw new HttpError(401, "Authentication required.", undefined, "unauthorized");
  }
}

export async function assertActiveAuthUser(auth: { userId: string }) {
  await assertActiveUserById(auth.userId);
}
