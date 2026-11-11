/**
 * F1.4 OCR assist · read side for Ops: one provider's licence records with their suggested fields. Read-only.
 * Access: the identity auditor roles (admin, ops) — the caller passes the viewer's role and gets null otherwise.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, type Role } from "@/db/schema";
import type { LicenceRecord, ProviderProfile } from "@/lib/identity/provider";

export const LICENCE_REVIEW_ROLES: Role[] = ["admin", "ops"];

export async function licenceReview(viewerRole: Role, userId: string): Promise<{ name: string; role: Role; licences: LicenceRecord[] } | null> {
  if (!LICENCE_REVIEW_ROLES.includes(viewerRole)) return null;
  const [u] = await db.select({ name: users.name, role: users.role, profile: users.profile }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  const p = ((u.profile as { provider?: Partial<ProviderProfile> }).provider ?? {}) as Partial<ProviderProfile>;
  return { name: u.name, role: u.role, licences: p.licences ?? [] };
}
