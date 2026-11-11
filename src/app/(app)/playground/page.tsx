/** Judge Playground page (extras A6, A12): F5.06 four-quadrant playground, F5.07 time machine, F5.08 chaos injector. Sandbox only (P9). */
import { notFound } from "next/navigation";
import { sandboxMode } from "@/lib/clock";
import { requireViewer } from "@/lib/session";
import { Playground } from "@/components/playground/Playground";
import { latestSimFor, PLAYGROUND_ROLES, playgroundState } from "@/server/playground";
import { scenarioFromQuery } from "@/server/playground/state";
import { latestPairFor } from "@/server/playground/pairs";

export const metadata = { title: "Judge Playground" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ scenario?: string | string[] }> }) {
  if (!sandboxMode()) notFound();
  // /playground?scenario=S1…S7 preselects and scrolls to that scenario (the judge tour links here); other values are ignored.
  const asked = (await searchParams).scenario;
  const v = await requireViewer(PLAYGROUND_ROLES);
  const sim = await latestSimFor(v.id);
  const state = await playgroundState(sim?.id ?? null);
  const pair = await latestPairFor(v); // A12: the judge's latest Pair A vs Pair B, if any
  const focus = scenarioFromQuery(asked, state.scenarios.map((x) => x.id));
  return <Playground initial={state} pair={pair} focus={focus} />;
}
