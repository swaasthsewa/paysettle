/** Switchboard flags (F5.03, P9). Flips go through four-eyes dual control; reading is open to server code. */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { flags } from "@/db/schema";
import type { Dbx } from "./common";

export const FLAG_DEFS = {
  "ai.enabled": { on: true, label: "AI assistance", note: "Drafting, criteria compiler, evidence verifier and mediation proposals. Advisory only (P3); rules decide." },
  "rail.B": { on: false, label: "Rail B (delayed disbursement)", note: "Offers PayPal delayed disbursement to new contracts. Needs the Day-0 spike result." },
  "playground.live": { on: false, label: "Playground uses live PayPal Sandbox", note: "Off: the Judge Playground runs on the deterministic mock rail. Sandbox only (P9)." },
  "deemed_approval.allowed": { on: false, label: "Deemed approval allowed", note: "Lets contracts choose deemed approval at 72 h instead of escalation to Ops." },
} as const;
export type FlagKey = keyof typeof FLAG_DEFS;
export const FLAG_KEYS = Object.keys(FLAG_DEFS) as FlagKey[];
export const isFlagKey = (k: string): k is FlagKey => (FLAG_KEYS as string[]).includes(k);

/** Current value of a flag; falls back to its default when the row does not exist yet. */
export async function flagOn(key: FlagKey, dbx: Dbx = db): Promise<boolean> {
  const [r] = await dbx.select({ on: flags.on }).from(flags).where(eq(flags.key, key)).limit(1);
  return r ? r.on : FLAG_DEFS[key].on;
}

export async function allFlags(dbx: Dbx = db) {
  const rows = await dbx.select().from(flags);
  return FLAG_KEYS.map((key) => {
    const r = rows.find((x) => x.key === key);
    return { key, label: FLAG_DEFS[key].label, note: FLAG_DEFS[key].note, on: r ? r.on : FLAG_DEFS[key].on, stored: Boolean(r), updatedAt: r?.updatedAt ?? null };
  });
}

/** Insert defaults for flags that have no row yet (seed). Never overwrites a flipped value. */
export async function ensureFlagDefaults(dbx: Dbx = db) {
  for (const key of FLAG_KEYS) await dbx.insert(flags).values({ key, on: FLAG_DEFS[key].on, note: FLAG_DEFS[key].note }).onConflictDoNothing();
}
