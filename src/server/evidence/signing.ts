/**
 * P4 P8 approval signatures: HMAC-SHA256 with the deployment key over (milestoneId + evidence root hash).
 * Kept apart from the evidence module so the money module can check a signature without importing the evidence
 * module (which imports money to trigger the release).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { sandboxMode } from "@/lib/clock";
import { sha256 } from "@/lib/ids";

function signingKey(): string {
  const k = process.env.SIGNING_KEY;
  if (k) return k;
  if (!sandboxMode()) throw new Error("SIGNING_KEY is not set (P8)");
  // Sandbox only: a key derived from this deployment's database address, so local demos work without setup.
  return sha256("paysettle-sandbox-approval-key:" + (process.env.DATABASE_URL ?? "local"));
}
export const approvalSignature = (milestoneId: string, rootHash: string) => createHmac("sha256", signingKey()).update(milestoneId + rootHash).digest("hex");
/** HMAC with the same deployment key as approvals, for other signed evidence-module consents (F3.03 sequence override). */
export const evidenceHmac = (payload: string) => createHmac("sha256", signingKey()).update(payload).digest("hex");
export function verifyApprovalSignature(milestoneId: string, rootHash: string, sig: string): boolean {
  const want = Buffer.from(approvalSignature(milestoneId, rootHash), "hex"), got = Buffer.from(sig ?? "", "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}
