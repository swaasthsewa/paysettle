/**
 * F5.01 Seeded demo fixtures that show a reconciliation exception on purpose. scripts/seed-control.ts injects a
 * duplicate release posting into the "Inventory dashboard" contract (ws_ctl_w9) so the per-tranche circuit breaker
 * can be seen pausing one tranche. The consoles label these rows so a reviewer does not read them as a fault in their
 * own contract. Labels only: the reconciliation logic and its verdict are unchanged. Sandbox only.
 */
import { sandboxMode } from "@/lib/clock";

export const SEEDED_DRIFT_WORKSPACES: readonly string[] = ["ws_ctl_w9"];
export const SEEDED_EXAMPLE_LABEL = "Seeded example: shows how the breaker pauses one tranche";

/** True for a tranche id (`<workspace>_t<n>`) or workspace id that belongs to a seeded drift fixture, in sandbox mode. */
export function isSeededExample(id: string): boolean {
  if (!sandboxMode()) return false;
  return SEEDED_DRIFT_WORKSPACES.some((w) => id === w || id.startsWith(`${w}_t`));
}
