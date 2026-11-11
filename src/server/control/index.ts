/**
 * Control plane: three-way reconciliation (F5.01), webhook DLQ/replay (F5.02), four-eyes (F5.03),
 * flags, analytics (F5.09, F2.12), provider health (F5.10). Signatures fixed by src/server/types.ts contract.
 */
import type { Actor } from "../types";
import { runReconcile } from "./recon";
import { approve, propose } from "./dual";

/** Every real tranche by default; `trancheIds` limits the run to those tranches (a playground run checks only its own). */
export async function reconcile(a: Actor | null, window?: { from: Date; to: Date }, opts: { trancheIds?: string[] } = {}): Promise<{ runId: string; verdict: "CLEAN" | "IN_FLIGHT" | "DRIFT" }> {
  const r = await runReconcile(a, window, { trancheIds: opts.trancheIds });
  return { runId: r.runId, verdict: r.verdict };
}
export async function proposeDualControl(a: Actor, action: string, target: string, payload: unknown, reason: string): Promise<string> {
  return propose(a, action, target, payload, reason);
}
export async function approveDualControl(a: Actor, id: string): Promise<void> {
  await approve(a, id);
}

/* Extra exports other modules may use (additive; not part of the service contract). */
export { flagOn, FLAG_KEYS, type FlagKey } from "./flags";
export { feeBpsFor } from "./fees";
export { registerWebhookReplayHandler, type WebhookReplayHandler } from "./dual";
