/**
 * F1.10 The signed-in person's own notices, read-only: hold and money notices (money_notices, F3.11) and review-timer
 * notices (evidence_notifications, F3.06), newest first. Rows addressed to the person, plus rows addressed to their
 * role with no named person (for example Operations escalations). Nobody sees another person's notices.
 */
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { workspaces, type Role } from "@/db/schema";
import { moneyNotices } from "@/db/schema-money";
import { evidenceNotifications } from "@/db/schema-evidence";

export interface NoticeItem { id: string; source: "money" | "evidence"; kind: string; title: string; body: string; createdAt: Date; contractTitle: string; href: string }

export async function noticesForViewer(v: { id: string; role: Role }, limit = 100): Promise<NoticeItem[]> {
  const money = await db.select({ n: moneyNotices, title: workspaces.title }).from(moneyNotices)
    .innerJoin(workspaces, eq(workspaces.id, moneyNotices.workspaceId))
    .where(eq(moneyNotices.userId, v.id)).orderBy(desc(moneyNotices.createdAt)).limit(limit);
  const ev = await db.select({ n: evidenceNotifications, title: workspaces.title }).from(evidenceNotifications)
    .innerJoin(workspaces, eq(workspaces.id, evidenceNotifications.workspaceId))
    .where(or(eq(evidenceNotifications.toUserId, v.id), and(isNull(evidenceNotifications.toUserId), eq(evidenceNotifications.toRole, v.role))))
    .orderBy(desc(evidenceNotifications.createdAt)).limit(limit);
  const items: NoticeItem[] = [
    ...money.map(({ n, title }) => ({ id: n.id, source: "money" as const, kind: n.kind, title, body: n.message, createdAt: n.createdAt, contractTitle: title, href: `/contracts/${n.workspaceId}` })),
    ...ev.map(({ n, title }) => ({ id: n.id, source: "evidence" as const, kind: n.kind, title: n.title, body: n.body, createdAt: n.createdAt, contractTitle: title, href: `/contracts/${n.workspaceId}/m/${n.milestoneId}` })),
  ];
  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}
