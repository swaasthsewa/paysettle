// F2.02 · IDENTITY — same-network warning between the two parties of a contract (self-dealing / one person on both
// sides). No new personal data is collected: the helper reads the IP addresses PaySettle already records when a person
// accepts the platform terms at sign-in (terms_decisions.ip, F1.8) and when they sign a contract (signatures.ip, F2.10).
//
//   same_address   both people used the very same public address within the window (strong hint; warn)
//   same_network   the same IPv4 /24 or IPv6 /64 (an office, a household, a mobile carrier pool; weak hint; info)
//   none           nothing shared, or not enough history
// Private, loopback, link-local and carrier-grade NAT addresses, and "local" (no proxy header), are never compared:
// they say nothing about who is behind them. The answer carries counts and a masked network label ("203.0.113.x"),
// never a full address, so it can be shown to Ops or written to the audit trail. It is a signal for a person to weigh,
// not a decision: it blocks nothing by itself (it is wired into sign and fund as a warning).
import { and, eq, gte } from "drizzle-orm";
import { db, type Db, type Tx } from "@/db/client";
import { signatures } from "@/db/schema";
import { termsDecisions } from "@/db/schema-identity";

export interface IpSeen { ip: string; at: Date }
export type NetworkLevel = "none" | "same_network" | "same_address";
export interface NetworkSignal {
  level: NetworkLevel; tone: "ok" | "plain" | "warn";
  sharedAddresses: number; sharedNetworks: number; lastSharedAt: Date | null;
  networks: string[]; summary: string; considered: { a: number; b: number };
}

export const SIGNAL_WINDOW_DAYS = 180;

/** IPv4 dotted quad → its four numbers, or null. */
function v4(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const n = m.slice(1).map(Number);
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}
/** IPv6 → eight hextets (expanded), or null. */
function v6(ip: string): number[] | null {
  if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(":")) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [], tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const parts = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/i.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}

/** Normalise one recorded address: trims, drops a port, unwraps IPv4-mapped IPv6. Null for anything not comparable. */
export function normaliseIp(raw: string | null | undefined): { kind: 4 | 6; ip: string; net: string; label: string } | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s || s === "local" || s === "unknown") return null;
  s = s.replace(/^\[(.+)\](?::\d+)?$/, "$1");
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.replace(/:\d+$/, "");
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) s = mapped[1];
  const a = v4(s);
  if (a) {
    const [x, y] = a;
    const nonPublic = x === 0 || x === 10 || x === 127 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || x >= 224;
    if (nonPublic) return null;
    return { kind: 4, ip: a.join("."), net: a.slice(0, 3).join("."), label: `${a.slice(0, 3).join(".")}.x` };
  }
  const b = v6(s);
  if (b) {
    const first = b[0];
    const nonPublic = b.every((h) => h === 0) || (b.slice(0, 7).every((h) => h === 0) && b[7] === 1) || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
    if (nonPublic) return null;
    const hex = b.map((h) => h.toString(16));
    return { kind: 6, ip: hex.join(":"), net: hex.slice(0, 4).join(":"), label: `${hex.slice(0, 4).join(":")}::/64` };
  }
  return null;
}

/** Compare two people's address histories. Pure. `now` and the window decide which sightings count. */
export function compareNetworks(a: IpSeen[], b: IpSeen[], o: { now?: Date; windowDays?: number } = {}): NetworkSignal {
  const now = o.now ?? new Date();
  const since = now.getTime() - (o.windowDays ?? SIGNAL_WINDOW_DAYS) * 86_400_000;
  const keep = (l: IpSeen[]) => l.filter((x) => x.at.getTime() >= since && x.at.getTime() <= now.getTime() + 60_000)
    .map((x) => ({ n: normaliseIp(x.ip), at: x.at })).filter((x): x is { n: NonNullable<ReturnType<typeof normaliseIp>>; at: Date } => x.n !== null);
  const A = keep(a), B = keep(b);
  const latest = (list: typeof A, pred: (x: (typeof A)[number]) => boolean) => list.filter(pred).reduce<Date | null>((m, x) => (!m || x.at > m ? x.at : m), null);
  const addrA = new Set(A.map((x) => x.n.ip)), addrB = new Set(B.map((x) => x.n.ip));
  const netA = new Set(A.map((x) => x.n.net)), netB = new Set(B.map((x) => x.n.net));
  const sharedAddr = [...addrA].filter((x) => addrB.has(x));
  const sharedNet = [...netA].filter((x) => netB.has(x));
  const labels = [...new Set([...A, ...B].filter((x) => sharedNet.includes(x.n.net)).map((x) => x.n.label))].sort();
  const lastShared = (() => {
    if (!sharedNet.length) return null;
    const la = latest(A, (x) => sharedNet.includes(x.n.net)), lb = latest(B, (x) => sharedNet.includes(x.n.net));
    return la && lb ? (la < lb ? la : lb) : null;
  })();
  const considered = { a: A.length, b: B.length };
  if (sharedAddr.length) return { level: "same_address", tone: "warn", sharedAddresses: sharedAddr.length, sharedNetworks: sharedNet.length, lastSharedAt: lastShared, networks: labels, considered,
    summary: `Both parties used the same internet address (${labels.join(", ")}) in the last ${o.windowDays ?? SIGNAL_WINDOW_DAYS} days. That can mean one person on both sides of the contract; check before signing or funding.` };
  if (sharedNet.length) return { level: "same_network", tone: "plain", sharedAddresses: 0, sharedNetworks: sharedNet.length, lastSharedAt: lastShared, networks: labels, considered,
    summary: `Both parties used the same network (${labels.join(", ")}) recently. Common for colleagues or a shared carrier; a weak hint on its own.` };
  return { level: "none", tone: "ok", sharedAddresses: 0, sharedNetworks: 0, lastSharedAt: null, networks: [], considered,
    summary: considered.a && considered.b ? "No shared address or network in the recorded history." : "Not enough address history to compare." };
}

/** Every public address a person was seen at (terms acceptance at sign-in, contract signatures), newest window only. */
export async function ipHistory(userId: string, q: Db | Tx = db, since = new Date(Date.now() - SIGNAL_WINDOW_DAYS * 86_400_000)): Promise<IpSeen[]> {
  const [t, s] = await Promise.all([
    q.select({ ip: termsDecisions.ip, at: termsDecisions.at }).from(termsDecisions).where(and(eq(termsDecisions.userId, userId), gte(termsDecisions.at, since))),
    q.select({ ip: signatures.ip, at: signatures.createdAt }).from(signatures).where(and(eq(signatures.signerId, userId), gte(signatures.createdAt, since))),
  ]);
  return [...t, ...s].filter((r): r is { ip: string; at: Date } => typeof r.ip === "string" && r.ip.length > 0);
}

/**
 * F2.02 · the same-network signal for two people (for example the client and the provider of a contract, at sign or
 * fund). Same person on both ids → "none" (nothing to compare against).
 */
export async function sameNetworkSignal(userA: string, userB: string, o: { now?: Date; windowDays?: number; q?: Db | Tx } = {}): Promise<NetworkSignal> {
  if (userA === userB) return compareNetworks([], [], o);
  const now = o.now ?? new Date();
  const since = new Date(now.getTime() - (o.windowDays ?? SIGNAL_WINDOW_DAYS) * 86_400_000);
  const [a, b] = await Promise.all([ipHistory(userA, o.q ?? db, since), ipHistory(userB, o.q ?? db, since)]);
  return compareNetworks(a, b, { now, windowDays: o.windowDays });
}
