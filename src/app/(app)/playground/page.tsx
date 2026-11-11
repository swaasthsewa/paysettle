/**
 * Judge Playground page (extras A6, A12): F5.06 four-quadrant playground, F5.07 time machine, F5.08 chaos injector. Sandbox only (P9).
 * Judges share one account, so the page shows the run and the pair this browser holds (ps_sim, ps_pair cookies), never
 * the account's latest run, which could be another judge's.
 */
import { notFound } from "next/navigation";
import { sandboxMode } from "@/lib/clock";
import { requireViewer } from "@/lib/session";
import { Playground } from "@/components/playground/Playground";
import { DomainError } from "@/server/types";
import { PLAYGROUND_ROLES, playgroundState } from "@/server/playground";
import { scenarioFromQuery } from "@/server/playground/state";
import { pairResult } from "@/server/playground/pairs";
import { heldPair, heldSim } from "@/server/playground/owner";

export const metadata = { title: "Judge Playground" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ scenario?: string | string[] }> }) {
  if (!sandboxMode()) notFound();
  // /playground?scenario=S1…S7 preselects and scrolls to that scenario (the judge tour links here); other values are ignored.
  const asked = (await searchParams).scenario;
  const v = await requireViewer(PLAYGROUND_ROLES);
  const simId = await heldSim();
  // a cookie naming a run that no longer exists (the demo data was reset) shows the empty playground
  const state = await playgroundState(simId).catch((e) => { if (e instanceof DomainError && e.code === "SIM_NOT_FOUND") return playgroundState(null); throw e; });
  const pairId = await heldPair();
  const pair = pairId ? await pairResult(v, pairId).catch(() => null) : null; // A12: the Pair A vs Pair B this browser built last
  const focus = scenarioFromQuery(asked, state.scenarios.map((x) => x.id));
  return <Playground initial={state} pair={pair} focus={focus} />;
}
