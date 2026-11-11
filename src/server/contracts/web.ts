/**
 * F2.03 F2.10 — glue between the contracts screens and the service: the signed-in person as an Actor (with session MFA
 * and request facts for the signature record), and turning a DomainError into a calm message for the page.
 */
import { clientInfo, requireViewer, type Viewer } from "@/lib/session";
import type { Role } from "@/db/schema";
import type { Actor } from "../types";

export async function currentActor(roles?: Role[]): Promise<{ v: Viewer; a: Actor & { mfa: boolean; ip: string; userAgent: string } }> {
  const v = await requireViewer(roles);
  const info = await clientInfo();
  return { v, a: { id: v.id, role: v.role, name: v.name, mfa: v.mfa, ip: info.ip, userAgent: info.userAgent } };
}

/** DomainError (by shape, so it survives bundling) → message; anything else is re-thrown. */
export function domainMessage(e: unknown): string {
  const c = e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : null;
  if (typeof c === "string" && /^[A-Z]+(_[A-Z]+)*$/.test(c)) return String((e as Error).message);
  throw e;
}
