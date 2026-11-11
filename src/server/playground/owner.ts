/**
 * Which playground run belongs to this browser (F5.06, P9). Every judge signs in as the same demo judge, so "the judge's
 * latest run" would often be another judge's run. The run id therefore lives in an httpOnly cookie that this browser gets
 * when it starts or resets a run (and the Pair A vs Pair B id in a second one); every sandbox route and playground action
 * refuses any other id. No cookie means no run is shown, never someone else's.
 */
import { cookies } from "next/headers";
import { DomainError } from "../types";

export const SIM_COOKIE = "ps_sim";
export const PAIR_COOKIE = "ps_pair";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/* same lifetime as the longest session (12 h); Lax keeps it on the page's own fetch and form posts */
const OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 };

export class NotYourRun extends DomainError {
  constructor() { super("SIM_NOT_FOUND", "That playground run is not open in this browser. Start a scenario to get a run of your own."); }
}

/** True when `asked` is the run this browser holds (pure, so it can be tested without a request). */
export function ownsRun(held: string | null | undefined, asked: string | null | undefined): boolean {
  return Boolean(held && asked && held === asked && ID.test(held));
}

async function read(name: string): Promise<string | null> {
  const v = (await cookies()).get(name)?.value;
  return v && ID.test(v) ? v : null;
}

/** The run id this browser holds, or null. */
export const heldSim = () => read(SIM_COOKIE);
/** Remembers the run this browser just started or reset. Route handlers and server actions only. */
export async function holdSim(simId: string) { (await cookies()).set(SIM_COOKIE, simId, OPTS); }
/** Throws SIM_NOT_FOUND unless `simId` is the run this browser holds. */
export async function assertOwnSim(simId: string) { if (!ownsRun(await heldSim(), simId)) throw new NotYourRun(); }

/** The Pair A vs Pair B id this browser built last, or null. */
export const heldPair = () => read(PAIR_COOKIE);
export async function holdPair(pairId: string) { (await cookies()).set(PAIR_COOKIE, pairId, OPTS); }
