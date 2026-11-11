/**
 * Permission law as data (pattern, see REUSE.md).
 * Values: "Y" allowed · "R" read · "own" own records · "case" assigned cases · "agg" aggregated only · "-" denied.
 * Judge rights apply only in sandbox mode (P9). Tested exhaustively in rbac.test.ts.
 */
import type { Role } from "@/db/schema";
import { sandboxMode } from "./clock";

export const PERMISSIONS = [
  "contract.create", "contract.negotiate", "contract.sign", "hold.fund", "evidence.submit", "release.approve",
  "dispute.open", "dispute.bid", "dispute.verdict", "contract.clear_high_risk", "oracle.manual_verify", "fee.configure",
  "recon.run", "breaker.clear", "webhook.replay", "audit.read", "blueprint.publish", "analytics.read",
  "sandbox.time_travel", "sandbox.chaos",
  "blog.write", "blog.publish", "mediator.verify",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type Grant = "Y" | "R" | "own" | "case" | "agg" | "-";
const ORDER: Role[] = ["client", "provider", "admin", "ops", "mediator", "finance", "judge", "marketing"];
const M: Record<Permission, string> = {
  "contract.create": "Y Y - - - - Y -", "contract.negotiate": "Y Y - - - - Y -", "contract.sign": "Y Y - - - - Y -",
  "hold.fund": "Y - - - - - Y -", "evidence.submit": "- Y - - - - Y -", "release.approve": "Y - - - - - Y -",
  "dispute.open": "Y Y - Y - - Y -", "dispute.bid": "Y Y - - - - Y -", "dispute.verdict": "- - - - Y - Y -",
  "contract.clear_high_risk": "- - - Y - - - -", "oracle.manual_verify": "- - - Y - - - -", "fee.configure": "- - - - - Y - -",
  "recon.run": "- - Y - - Y R -", "breaker.clear": "- - - Y - Y - -", "webhook.replay": "- - Y Y - - - -",
  "audit.read": "own own Y Y case Y R -", "blueprint.publish": "- - - Y - - - Y", "analytics.read": "own own Y Y own Y R agg",
  "sandbox.time_travel": "- - Y - - - Y -", "sandbox.chaos": "- - Y - - - Y -",
  "blog.write": "- - Y - - - - Y", "blog.publish": "- - Y - - - - Y", "mediator.verify": "- - Y Y - - - -",
};
/** Permissions that need two different people (four-eyes, F5.03). */
export const FOUR_EYES: Permission[] = ["breaker.clear", "webhook.replay"];

export function grant(role: Role, p: Permission): Grant {
  const g = M[p].split(" ")[ORDER.indexOf(role)] as Grant;
  if (role === "judge" && !sandboxMode()) return "-";
  return g;
}
export const can = (role: Role, p: Permission) => grant(role, p) !== "-";
export const canWrite = (role: Role, p: Permission) => { const g = grant(role, p); return g === "Y" || g === "own" || g === "case"; };
export const matrix = () => PERMISSIONS.map((p) => ({ permission: p, grants: ORDER.map((r) => grant(r, p)) }));
export const ROLE_ORDER = ORDER;
