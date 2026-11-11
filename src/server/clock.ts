/** Per-workspace virtual time. The playground stores an hour offset per workspace in sim_sessions. */
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { simSessions } from "@/db/schema";
import { nowFor } from "@/lib/clock";
export async function offsetFor(workspaceId: string): Promise<number> {
  const [s] = await db.select({ h: simSessions.clockOffsetHours }).from(simSessions).where(eq(simSessions.workspaceId, workspaceId)).orderBy(desc(simSessions.createdAt)).limit(1);
  return s?.h ?? 0;
}
export async function workspaceNow(workspaceId: string): Promise<Date> { return nowFor(await offsetFor(workspaceId)); }
