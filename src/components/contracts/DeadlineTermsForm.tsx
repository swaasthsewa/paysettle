"use client";
/**
 * F2.05 — "Deadline terms" parameter form for the negotiation room (numbers, not free text) with a live preview of
 * what each term does to each payment milestone ("2 days late → −$4.50 on M02"). The server re-validates everything and
 * the policy gate (R11/R12) decides; the hints here only mirror those rules. Saving creates a new revision.
 */
import { useId, useMemo, useState } from "react";
import { BPS_FULL, formatCents } from "@/lib/money";
import { DEADLINE_DEFAULTS, DEADLINE_LIMITS, adjustmentFor, appliesTo, dueOffsetDays, maxBonusCents, type DeadlineTerms } from "@/lib/deadline";
import "@/styles/deadline.css";

export interface TermsMilestone { code: string; title: string; amountCents: number; targetDay: number; trancheIdx: number }

/** "0.5" → 50 bps; "10" → 1000. Two decimals at most; null when it is not a plain percentage 0–100. */
function pctToBps(s: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(s);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bps <= BPS_FULL ? bps : null;
}
function dollarsToCents(s: string): number | null {
  const m = /^\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(s);
  if (!m) return null;
  return Number(m[1].replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}
const intOf = (s: string) => (/^\s*\d{1,3}\s*$/.test(s) ? Number(s) : null);
const pctText = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
const bpsInput = (bps: number) => (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function DeadlineTermsForm({ workspaceId, revision, totalCents, milestones, terms, editable, action }: {
  workspaceId: string; revision: number; totalCents: number; milestones: TermsMilestone[]; terms: DeadlineTerms | null; editable: boolean;
  action: (f: FormData) => Promise<void>;
}) {
  const id = useId();
  const L = terms?.late, E = terms?.early;
  const [lateOn, setLateOn] = useState(Boolean(L));
  const [lateRate, setLateRate] = useState(bpsInput(L?.rateBps ?? DEADLINE_DEFAULTS.late.rateBps));
  const [grace, setGrace] = useState(String(L?.graceDays ?? DEADLINE_DEFAULTS.late.graceDays));
  const [lateCap, setLateCap] = useState(bpsInput(L?.capBps ?? DEADLINE_DEFAULTS.late.capBps));
  const [lateAll, setLateAll] = useState(!L || L.milestones === "ALL");
  const [lateCodes, setLateCodes] = useState<string[]>(L && L.milestones !== "ALL" ? L.milestones : []);
  const [earlyOn, setEarlyOn] = useState(Boolean(E));
  const defaultPool = Math.max(100, Math.round(totalCents / 100)); // 1% of the contract, the default cap per milestone
  const [pool, setPool] = useState(((E?.poolCents ?? defaultPool) / 100).toFixed(2));
  const [earlyRate, setEarlyRate] = useState(bpsInput(E?.rateBps ?? DEADLINE_DEFAULTS.early.rateBps));
  const [minEarly, setMinEarly] = useState(String(E?.minDaysEarly ?? DEADLINE_DEFAULTS.early.minDaysEarly));
  const [earlyCap, setEarlyCap] = useState(bpsInput(E?.capBps ?? DEADLINE_DEFAULTS.early.capBps));
  const [earlyAll, setEarlyAll] = useState(!E || E.milestones === "ALL");
  const [earlyCodes, setEarlyCodes] = useState<string[]>(E && E.milestones !== "ALL" ? E.milestones : []);

  const parsed = useMemo(() => {
    const errs: string[] = [];
    let late: DeadlineTerms["late"] = null, early: DeadlineTerms["early"] = null;
    if (lateOn) {
      const r = pctToBps(lateRate), g = intOf(grace), c = pctToBps(lateCap);
      if (!r) errs.push("Late: the daily rate must be a percentage above 0, up to two decimals.");
      if (g === null) errs.push("Late: grace days must be a whole number.");
      if (!c) errs.push("Late: the cap must be a percentage above 0.");
      if (!lateAll && !lateCodes.length) errs.push("Late: pick at least one milestone, or apply it to all.");
      if (r && g !== null && c) late = { rateBps: r, graceDays: g, capBps: c, milestones: lateAll ? "ALL" : lateCodes };
    }
    if (earlyOn) {
      const p = dollarsToCents(pool), r = pctToBps(earlyRate), m = intOf(minEarly), c = pctToBps(earlyCap);
      if (p === null) errs.push("Bonus: the pool must be an amount in dollars, for example 60 or 60.00.");
      if (!r) errs.push("Bonus: the daily rate must be a percentage above 0.");
      if (!m) errs.push("Bonus: the minimum days early must be a whole number of 1 or more.");
      if (!c) errs.push("Bonus: the cap must be a percentage above 0.");
      if (!earlyAll && !earlyCodes.length) errs.push("Bonus: pick at least one milestone, or apply it to all.");
      if (p !== null && r && m && c) early = { poolCents: p, rateBps: r, minDaysEarly: m, capBps: c, milestones: earlyAll ? "ALL" : earlyCodes };
    }
    return { errs, terms: late || early ? { late, early } : null };
  }, [lateOn, lateRate, grace, lateCap, lateAll, lateCodes, earlyOn, pool, earlyRate, minEarly, earlyCap, earlyAll, earlyCodes]);

  const starts = useMemo(() => {
    const m = new Map<number, number>();
    for (const x of [...milestones].sort((a, b) => a.targetDay - b.targetDay)) if (!m.has(x.trancheIdx)) m.set(x.trancheIdx, x.trancheIdx === 1 ? 1 : x.targetDay);
    return m;
  }, [milestones]);
  const t = parsed.terms;
  const hints: string[] = [];
  if (t?.late) {
    if (t.late.capBps > DEADLINE_LIMITS.lateCapMaxBps) hints.push(`R11: the cap can be at most ${pctText(DEADLINE_LIMITS.lateCapMaxBps)}.`);
    if (t.late.graceDays < DEADLINE_LIMITS.minGraceDays) hints.push("R11: at least one grace day.");
    const capDay = t.late.graceDays + Math.ceil(t.late.capBps / t.late.rateBps);
    if (capDay > DEADLINE_LIMITS.capReachedByDay) hints.push(`R11: the cap is reached on day ${capDay}; it must be reached by day ${DEADLINE_LIMITS.capReachedByDay}.`);
  }
  const need = t?.early ? maxBonusCents(t, milestones.map((m) => ({ code: m.code, type: "PAY" as const, amountCents: m.amountCents, active: true, trancheIdx: m.trancheIdx, maxEarlyDays: dueOffsetDays(m.targetDay, m.trancheIdx, starts.get(m.trancheIdx) ?? 1) }))) : 0;
  if (t?.early) {
    if (t.early.poolCents * BPS_FULL > DEADLINE_LIMITS.poolMaxBps * totalCents) hints.push(`R12: the pool can be at most ${pctText(DEADLINE_LIMITS.poolMaxBps)} of the contract (${formatCents(Math.floor((totalCents * DEADLINE_LIMITS.poolMaxBps) / BPS_FULL))}).`);
    if (need > t.early.poolCents) hints.push(`R12: early delivery can earn up to ${formatCents(need)}; the pool must cover it.`);
  }

  const preview = (milestones.length && t) ? milestones.map((m) => {
    const lines: string[] = [];
    if (t.late && appliesTo(t.late.milestones, m.code)) {
      const n = t.late.graceDays + 1;
      const a = adjustmentFor(t, { code: m.code, type: "PAY", amountCents: m.amountCents }, { daysLate: n, daysEarly: 0, excusedDays: 0 }, 0);
      const capAt = t.late.graceDays + Math.ceil(t.late.capBps / t.late.rateBps);
      const c = adjustmentFor(t, { code: m.code, type: "PAY", amountCents: m.amountCents }, { daysLate: capAt, daysEarly: 0, excusedDays: 0 }, 0);
      lines.push(`${days(n)} late → −${formatCents(a.deductionCents)}; ${days(capAt)} or more → −${formatCents(c.deductionCents)} (cap)`);
    }
    if (t.early && appliesTo(t.early.milestones, m.code)) {
      const n = t.early.minDaysEarly;
      const a = adjustmentFor(t, { code: m.code, type: "PAY", amountCents: m.amountCents }, { daysLate: 0, daysEarly: n, excusedDays: 0 }, Number.MAX_SAFE_INTEGER);
      lines.push(`${days(n)} early → +${formatCents(a.bonusCents)} from the pool`);
    }
    return { m, lines };
  }).filter((x) => x.lines.length) : [];

  const scope = (all: boolean, setAll: (b: boolean) => void, codes: string[], setCodes: (c: string[]) => void, name: string, legend: string) => (
    <fieldset className="dl-scope" disabled={!editable}>
      <legend>{legend}</legend>
      <label><input type="radio" name={`${name}Scope`} value="ALL" checked={all} onChange={() => setAll(true)} /> Every payment milestone</label>
      <label><input type="radio" name={`${name}Scope`} value="SOME" checked={!all} onChange={() => setAll(false)} /> Only these:</label>
      {!all && (
        <div className="dl-codes">
          {milestones.map((m) => (
            <label key={m.code}><input type="checkbox" name={`${name}Codes`} value={m.code} checked={codes.includes(m.code)} onChange={(e) => setCodes(e.target.checked ? [...codes, m.code] : codes.filter((c) => c !== m.code))} /> {m.code} <span className="muted">{m.title}</span></label>
          ))}
        </div>
      )}
    </fieldset>
  );

  return (
    <form action={action} className="stack dl-form" aria-describedby={`${id}-help`}>
      <input type="hidden" name="wsId" value={workspaceId} /><input type="hidden" name="rev" value={revision} /><input type="hidden" name="anchor" value="deadline" />
      <p id={`${id}-help`} className="small muted">Both terms are off unless you switch them on. Saving makes a new revision and voids any signature on the current one: both of you agree by signing it.</p>
      <div className="dl-grid">
        <fieldset className="dl-term" disabled={!editable}>
          <legend><label><input type="checkbox" name="lateOn" checked={lateOn} disabled={!editable} onChange={(e) => setLateOn(e.target.checked)} /> Late delivery deduction</label></legend>
          <div className="dl-fields">
            <div className="field"><label htmlFor={`${id}-lr`}>Deduction per day late (%)</label><input id={`${id}-lr`} name="lateRate" inputMode="decimal" value={lateRate} onChange={(e) => setLateRate(e.target.value)} disabled={!lateOn} /></div>
            <div className="field"><label htmlFor={`${id}-lg`}>Grace days</label><input id={`${id}-lg`} name="lateGrace" type="number" min={0} max={60} value={grace} onChange={(e) => setGrace(e.target.value)} disabled={!lateOn} /></div>
            <div className="field"><label htmlFor={`${id}-lc`}>Cap per milestone (%)</label><input id={`${id}-lc`} name="lateCap" inputMode="decimal" value={lateCap} onChange={(e) => setLateCap(e.target.value)} disabled={!lateOn} /></div>
          </div>
          {lateOn && scope(lateAll, setLateAll, lateCodes, setLateCodes, "late", "Applies to")}
        </fieldset>
        <fieldset className="dl-term" disabled={!editable}>
          <legend><label><input type="checkbox" name="earlyOn" checked={earlyOn} disabled={!editable} onChange={(e) => setEarlyOn(e.target.checked)} /> Early-finish bonus</label></legend>
          <div className="dl-fields">
            <div className="field"><label htmlFor={`${id}-ep`}>Bonus pool (USD, funded with the hold)</label><input id={`${id}-ep`} name="earlyPool" inputMode="decimal" value={pool} onChange={(e) => setPool(e.target.value)} disabled={!earlyOn} /></div>
            <div className="field"><label htmlFor={`${id}-er`}>Bonus per day early (%)</label><input id={`${id}-er`} name="earlyRate" inputMode="decimal" value={earlyRate} onChange={(e) => setEarlyRate(e.target.value)} disabled={!earlyOn} /></div>
            <div className="field"><label htmlFor={`${id}-em`}>From how many days early</label><input id={`${id}-em`} name="earlyMin" type="number" min={1} max={60} value={minEarly} onChange={(e) => setMinEarly(e.target.value)} disabled={!earlyOn} /></div>
            <div className="field"><label htmlFor={`${id}-ec`}>Cap per milestone (%)</label><input id={`${id}-ec`} name="earlyCap" inputMode="decimal" value={earlyCap} onChange={(e) => setEarlyCap(e.target.value)} disabled={!earlyOn} /></div>
          </div>
          {earlyOn && scope(earlyAll, setEarlyAll, earlyCodes, setEarlyCodes, "early", "Applies to")}
        </fieldset>
      </div>

      <div className="dl-preview" aria-live="polite">
        <h3 className="small">Preview</h3>
        {parsed.errs.length > 0 && <ul className="dl-errs" role="alert">{parsed.errs.map((e) => <li key={e}>{e}</li>)}</ul>}
        {!t && !parsed.errs.length && <p className="small muted">No deadline terms: every milestone pays its amount whenever it is approved.</p>}
        {preview.length > 0 && <ul className="dl-lines">{preview.map(({ m, lines }) => <li key={m.code}><b>{m.code}</b> <span className="muted">{formatCents(m.amountCents)}</span> — {lines.join(" · ")}</li>)}</ul>}
        {t?.early && <p className="small">Client funds {formatCents(t.early.poolCents)} extra with the hold. Largest possible bonus: {formatCents(need)}. Whatever is not earned goes back to the client when the tranche closes.</p>}
        {t?.late && <p className="small">Deductions go back to the client. Time the client spends reviewing never counts against the provider; signed extensions and mediator rulings excuse days.</p>}
        {hints.length > 0 && <ul className="dl-hints">{hints.map((h) => <li key={h}>{h}</li>)}</ul>}
      </div>
      {editable && <div className="row"><button className="btn btn-g btn-sm" disabled={parsed.errs.length > 0}>Save deadline terms</button><span className="small muted">The policy gate checks rules R11 and R12 on the new revision.</span></div>}
    </form>
  );
}
