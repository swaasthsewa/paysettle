"use server";
/**
 * F2.03 F2.04 F2.05 F2.06 F2.10 — negotiation room server actions. Every change carries the revision the person saw,
 * so a stale edit is refused (merge required) instead of overwriting the other party's change. Also covers deadline terms.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applyChangeAt, parseDollarsToCents, parsePctToBps, sign } from "@/server/contracts";
import { currentActor, domainMessage } from "@/server/contracts/web";
import type { Change } from "@/server/types";
import type { ProofSpec } from "@/db/schema";
import type { DeadlineTerms } from "@/lib/deadline";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const intOf = (v: string) => (/^\d{1,6}$/.test(v) ? Number(v) : NaN);
const ARTIFACTS = ["IMAGE", "VIDEO", "PDF", "LOG", "LINK", "SIGNATURE", "ORACLE"] as const;

async function run(f: FormData, build: (rev: number) => Change[] | string) {
  const id = s(f, "wsId");
  if (!/^ws_[a-z0-9]{1,40}$/.test(id)) redirect("/client/contracts");
  const path = `/contracts/${id}`;
  const { a } = await currentActor();
  const rev = intOf(s(f, "rev"));
  let msg: string | null = null;
  const changes = build(rev);
  if (typeof changes === "string") msg = changes;
  else if (!changes.length) msg = "Nothing changed.";
  else {
    try {
      let expected: number | undefined = Number.isFinite(rev) ? rev : undefined;
      for (const c of changes) { const v = await applyChangeAt(a, id, c, expected); expected = v.revision; }
    } catch (e) { msg = domainMessage(e); }
  }
  revalidatePath(path);
  redirect(msg ? `${path}?err=${encodeURIComponent(msg)}` : `${path}#${f.get("anchor") === "deadline" ? "deadline" : "ms"}`);
}

export async function pruneAction(f: FormData) { await run(f, () => [{ action: "PRUNE", milestoneCode: s(f, "code") }]); }
export async function restoreAction(f: FormData) { await run(f, () => [{ action: "RESTORE", milestoneCode: s(f, "code") }]); }

export async function editMilestoneAction(f: FormData) {
  await run(f, () => {
    const code = s(f, "code"), out: Change[] = [];
    const day = intOf(s(f, "day")), oldDay = intOf(s(f, "oldDay"));
    if (!Number.isFinite(day)) return "Day must be a whole number.";
    if (day !== oldDay) out.push({ action: "SET_DAY", milestoneCode: code, day });
    if (f.has("share")) {
      const bps = parsePctToBps(s(f, "share"));
      if (bps === null) return "Share must be a percentage between 0 and 100, with up to two decimals.";
      if (bps !== intOf(s(f, "oldBps"))) out.push({ action: "SET_BPS", shares: { [code]: bps } });
    }
    return out;
  });
}

export async function appendMilestoneAction(f: FormData) {
  await run(f, () => {
    const type = s(f, "type") === "GATE" ? "GATE" : "PAY";
    const day = intOf(s(f, "day"));
    if (!Number.isFinite(day)) return "Day must be a whole number.";
    const bps = type === "GATE" ? 0 : parsePctToBps(s(f, "share") || "0");
    if (bps === null) return "Share must be a percentage between 0 and 100.";
    const kind = s(f, "artifact") as (typeof ARTIFACTS)[number];
    const min = intOf(s(f, "min") || "1");
    const proof: ProofSpec = {
      artifacts: ARTIFACTS.includes(kind) && Number.isFinite(min) && min > 0 ? [{ kind, min, note: s(f, "artifactNote").slice(0, 200) || undefined }] : [],
      criteria: s(f, "criteria").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 20),
    };
    const afterCode = s(f, "afterCode") || undefined;
    return [{ action: "APPEND", milestone: { title: s(f, "title"), type, day, bps, proof, lockRule: s(f, "lockRule"), disputeRule: s(f, "disputeRule"), afterCode } }];
  });
}

export async function toggleClauseAction(f: FormData) { await run(f, () => [{ action: "TOGGLE_CLAUSE", clauseCode: s(f, "code"), active: s(f, "active") === "1" }]); }
export async function appendClauseAction(f: FormData) {
  await run(f, () => [{ action: "APPEND_CLAUSE", title: s(f, "title"), body: s(f, "body"), linkedMilestone: s(f, "linked") || undefined }]);
}
export async function setTotalAction(f: FormData) {
  await run(f, () => {
    const c = parseDollarsToCents(s(f, "total"));
    return c === null ? "Enter the total in dollars, for example 6,000 or 6000.50." : [{ action: "SET_TOTAL", totalCents: c }];
  });
}

export async function signAction(f: FormData) {
  const id = s(f, "wsId");
  if (!/^ws_[a-z0-9]{1,40}$/.test(id)) redirect("/client/contracts");
  const path = `/contracts/${id}`;
  const { a } = await currentActor(["client", "provider"]);
  let msg: string | null = null;
  try { await sign(a, id, intOf(s(f, "rev")), s(f, "hash"), s(f, "mfa") || undefined); } catch (e) { msg = domainMessage(e); }
  revalidatePath(path);
  redirect(msg ? `${path}?err=${encodeURIComponent(msg)}` : `${path}?ok=signed`);
}

/**
 * F2.05 deadline terms from the room's parameter form (numbers only). Unchecked = off. A new revision voids
 * signatures; the policy gate (R11/R12) runs on it like on any other change.
 */
export async function setDeadlineTermsAction(f: FormData) {
  await run(f, () => {
    const codes = (k: string) => f.getAll(k).map((x) => String(x).trim()).filter((x) => /^[A-Za-z0-9_]{1,40}$/.test(x));
    const scope = (k: string) => (s(f, `${k}Scope`) === "SOME" ? codes(`${k}Codes`) : "ALL" as const);
    let late: DeadlineTerms["late"] = null, early: DeadlineTerms["early"] = null;
    if (f.get("lateOn")) {
      const rateBps = parsePctToBps(s(f, "lateRate")), capBps = parsePctToBps(s(f, "lateCap")), graceDays = intOf(s(f, "lateGrace"));
      if (!rateBps || !capBps || !Number.isFinite(graceDays)) return "Late deduction: give the daily rate and the cap as percentages and the grace days as a whole number.";
      const ms = scope("late");
      if (ms !== "ALL" && !ms.length) return "Late deduction: pick at least one milestone, or apply it to every payment milestone.";
      late = { rateBps, capBps, graceDays, milestones: ms };
    }
    if (f.get("earlyOn")) {
      const poolCents = parseDollarsToCents(s(f, "earlyPool")), rateBps = parsePctToBps(s(f, "earlyRate")), capBps = parsePctToBps(s(f, "earlyCap")), minDaysEarly = intOf(s(f, "earlyMin"));
      if (poolCents === null || !rateBps || !capBps || !Number.isFinite(minDaysEarly) || minDaysEarly < 1) return "Early bonus: give the pool in dollars, the daily rate and the cap as percentages, and the minimum days early as a whole number.";
      const ms = scope("early");
      if (ms !== "ALL" && !ms.length) return "Early bonus: pick at least one milestone, or apply it to every payment milestone.";
      early = { poolCents, rateBps, capBps, minDaysEarly, milestones: ms };
    }
    return [{ action: "SET_DEADLINE_TERMS", terms: late || early ? { late, early } : null }];
  });
}
