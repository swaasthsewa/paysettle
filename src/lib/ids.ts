import { createHash, randomUUID } from "node:crypto";
/** Deterministic idempotency keys (P2): UUIDv5-style from a namespace and parts. Same inputs → same key, always. */
const NS = "8f1c2d4e-paysettle";
export function idemKey(...parts: (string | number)[]): string {
  const h = createHash("sha1").update(NS + ":" + parts.join(":")).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
