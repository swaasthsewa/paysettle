/** Shared console formatting (F5.01–F5.10 screens). Plain module: usable from server and client components alike. */
const STATE_TONE: Record<string, string> = {
  HELD: "held", PARTIALLY_RELEASED: "held", AWAITING_APPROVAL: "held", AWAITING: "held", IN_FLIGHT: "held", RECEIVED: "held", SETTLING: "held", ROLLED_OVER: "held", PENDING_OPS: "held", LOCKED: "held",
  RELEASED: "released", CLOSED: "released", EXECUTED: "released", PROCESSED: "released", MATCHED: "released", CLEAN: "released", COMPLETED: "released", SIGNED: "released", ON_TIME: "released",
  BREAKER: "disputed", DRIFT: "disputed", DEAD: "disputed", DISPUTED: "disputed", ESCALATED: "disputed", QUARANTINED: "disputed", FAILED: "disputed", BREACHED: "disputed", TIER1: "disputed", TIER2: "disputed", TIER3: "disputed",
  REFUNDED: "refunded", VOIDED: "refunded", EXPIRED: "refunded", VETOED: "refunded", DUPLICATE: "refunded", UNAVAILABLE: "refunded", ABANDONED: "refunded",
};
export const stateClass = (s: string) => `state ${STATE_TONE[s] ?? "draft"}`;
export const human = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Stable, timezone-free date text so server and browser render the same thing. */
export function fmtDate(v: string | number | Date | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export function fmtAge(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} days`;
}
export const fmtHours = (h: number) => (h < 0 ? `${Math.abs(h)} h overdue` : h < 48 ? `${h} h left` : `${Math.floor(h / 24)} days ${h % 24} h left`);
