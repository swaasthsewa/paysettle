import { sha256 } from "./ids";
/** RFC 8785-style canonical JSON: sorted keys, no whitespace. Hash of this is what signatures bind to (P5). */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
export const canonicalHash = (v: unknown) => sha256(canonical(v));
