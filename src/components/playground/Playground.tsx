"use client";
/**
 * Judge Playground UI: F5.06 (scenario picker, live/mock switch, four-quadrant view, step runner),
 * F5.07 (time-machine slider, day 0–28, labelled as simulation), F5.08 (chaos injector, one-click reset).
 * Talks only to /api/sandbox/*; every simulated element carries a visible "Simulated" label.
 * The scenario list is data-driven (S7 shows once defined), plus A6 "Try to cheat" and A12 Pair A vs Pair B
 * (src/components/playground/Extras.tsx, server actions in src/app/(app)/playground/actions.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlaygroundState } from "@/server/playground/state";
import type { PairResult } from "@/server/playground/pairs";
import { PairPanel, TamperPanel } from "./Extras";
import "@/styles/playground.css";

type Mode = "LIVE" | "MOCK";
const usd = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);
const STATUS: Record<string, { icon: string; label: string }> = {
  done: { icon: "✓", label: "Done" }, skipped: { icon: "✓", label: "Not needed" }, waiting: { icon: "…", label: "Waiting" },
  error: { icon: "!", label: "Error" }, pending: { icon: "○", label: "Not run yet" },
};
const FAULTS: { id: string; label: string; hint: string; mockOnly?: boolean }[] = [
  { id: "valid_photo", label: "Valid photo", hint: "GPS 40 m from the site" },
  { id: "spoofed_gps", label: "Spoofed GPS", hint: "GPS 85 km away" },
  { id: "release_503", label: "PayPal 503 on release", hint: "next capture fails once", mockOnly: true },
  { id: "fund_503", label: "PayPal 503 on funding", hint: "next order fails once", mockOnly: true },
  { id: "duplicate_webhook", label: "Duplicate webhook", hint: "same transmission twice" },
  { id: "chargeback_webhook", label: "Chargeback webhook", hint: "CUSTOMER.DISPUTE.CREATED" },
  { id: "ledger_drift", label: "Ledger drift", hint: "one cent, no PayPal twin" },
];
const MARKS = [0, 7, 14, 22, 25, 27, 28];
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
/** The heading follows the scenario list (data-driven: S7 and later appear without code changes here). */
const scenarioCount = (n: number) => `${WORDS[n] ?? n} scenario${n === 1 ? "" : "s"}`;
const stateClass = (s: string) => /RELEASED|SETTLED|CLOSED|COMPLETED|APPROVED/.test(s) ? "released" : /HELD|LOCKED|SIGNED|OPEN|SUBMITTED|AWAITING/.test(s) ? "held" : /DISPUT|BREAKER|ESCALATED|REMEDIATION|FAILED/.test(s) ? "disputed" : /REFUND|VOID|ROLLED/.test(s) ? "refunded" : "draft";

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ message: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
  return j as T;
}

export function Playground({ initial, pair, focus }: { initial: PlaygroundState; pair?: PairResult | null; focus?: string | null }) {
  const [st, setSt] = useState<PlaygroundState>(initial);
  const [mode, setMode] = useState<Mode>(initial.sim?.mode ?? "MOCK");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  const [day, setDay] = useState<number>(Math.floor(initial.sim?.day ?? 0));
  const sim = st.sim;
  const simId = sim?.id ?? null;
  const wireRef = useRef<HTMLOListElement>(null);

  const apply = useCallback((s: PlaygroundState) => { setSt(s); setDay(Math.floor(s.sim?.day ?? 0)); }, []);
  const act = useCallback(async (label: string, fn: () => Promise<{ state: PlaygroundState } & Record<string, unknown>>, say?: (r: Record<string, unknown>) => { tone: "ok" | "warn" | "danger"; text: string } | null) => {
    setBusy(label); setMsg(null);
    try { const r = await fn(); apply(r.state); setMsg(say ? say(r) : null); }
    catch (e) { setMsg({ tone: "danger", text: (e as Error).message }); }
    finally { setBusy(null); }
  }, [apply]);

  const start = (id: string) => act(`start-${id}`, () => api(`/api/sandbox/scenarios/${id}/start`, { mode }), () => ({ tone: "ok", text: `Scenario ${id} started at simulated day 0. Press “Run next step” or “Run all”.` }));
  const sayRun = (r: Record<string, unknown>) => {
    const res = (r.results as { label: string; outcome: { status: string; detail: string } }[]) ?? [];
    const last = res[res.length - 1];
    if (!last) return { tone: "ok" as const, text: "Scenario complete." };
    const tone = last.outcome.status === "error" ? "danger" : last.outcome.status === "waiting" ? "warn" : "ok";
    return { tone, text: `${res.length} step(s) run. Last: ${last.label} — ${STATUS[last.outcome.status]?.label ?? last.outcome.status}.` } as const;
  };
  const runNext = (stepId?: string) => simId && act("run", () => api("/api/sandbox/step", { simId, stepId }), sayRun);
  const runAll = () => simId && act("all", () => api("/api/sandbox/step", { simId, all: true }), sayRun);
  const travel = (b: { hours?: number; toDay?: number }) => simId && act("time", () => api("/api/sandbox/time-travel", { simId, ...b }), (r) => {
    const t = r.result as { day: number; watchdog: { action: string }[]; reviewTimers: { action: string }[]; waiting: string[] };
    return { tone: t.waiting.length ? "warn" : "ok", text: `Simulated clock moved to day ${t.day}. Watchdog: ${t.watchdog.map((a) => a.action).join(", ") || "nothing due"}. Review timers: ${t.reviewTimers.map((a) => a.action).join(", ") || "nothing due"}.${t.waiting.length ? " " + t.waiting.join("; ") : ""}` };
  });
  const fault = (f: string) => simId && act(`fault-${f}`, () => api("/api/sandbox/faults", { simId, fault: f }), (r) => {
    const o = r.outcome as { status: string; detail: string };
    return { tone: o.status === "error" ? "danger" : o.status === "waiting" ? "warn" : "ok", text: o.detail };
  });
  const reset = () => simId && act("reset", () => api("/api/sandbox/reset", { simId }), () => ({ tone: "ok", text: "Fresh session at simulated day 0. The old contract is left as it was; audit rows are kept." }));
  const refresh = useCallback(async () => { if (!simId) return; try { apply((await api<{ state: PlaygroundState }>(`/api/sandbox/state?simId=${encodeURIComponent(simId)}`)).state); } catch { /* keep the last view */ } }, [simId, apply]);

  // In live mode a step may wait for the buyer to approve in PayPal. Refresh every 5 s; once PayPal's return page has
  // confirmed the hold (a tranche shows HELD), run the waiting step again so the scenario moves on by itself.
  const waitingStep = sim?.mode === "LIVE" ? st.steps.find((s) => s.status === "waiting") : undefined;
  const heldNow = (st.client?.tranches ?? []).some((t) => t.state === "HELD" || t.state === "PARTIALLY_RELEASED");
  useEffect(() => {
    if (!waitingStep || busy) return;
    const t = setInterval(() => { if (heldNow && simId) void act("run", () => api("/api/sandbox/step", { simId, stepId: waitingStep.id }), sayRun); else void refresh(); }, 5000);
    return () => clearInterval(t);
  }, [waitingStep, heldNow, busy, simId, refresh, act]);
  useEffect(() => { wireRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [st.wire.length]);
  // ?scenario=Sn (validated on the server) scrolls to that card and moves focus to its Start button once.
  useEffect(() => {
    if (!focus) return;
    const card = document.getElementById(`pg-scn-${focus}`);
    if (!card) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    card.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [focus]);

  const doneCount = st.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const current = useMemo(() => st.scenarios.find((s) => s.id === sim?.scenario), [st.scenarios, sim?.scenario]);
  const minDay = Math.ceil(sim?.day ?? 0);

  return (
    <div className="pg">
      <div className="phead">
        <div>
          <h1>Judge Playground</h1>
          <p className="sub">{scenarioCount(st.scenarios.length)} that drive the real application: contracts, PayPal holds, evidence, disputes and reconciliation. Pick one, choose a mode, then run it step by step.</p>
        </div>
        {sim && (
          <div className="stats">
            <div className="hstat"><div className="v">{doneCount}/{st.steps.length}</div><div className="l">steps done</div></div>
            <div className="hstat"><div className="v">day {sim.day}</div><div className="l">simulated time</div></div>
          </div>
        )}
      </div>

      <section className="c" aria-labelledby="pg-pick">
        <div className="c-head">
          <h2 id="pg-pick">1 · Pick a scenario</h2>
          <div className="r">
            <span className="lab" id="pg-mode-l">Mode</span>
            <div className="pills" role="radiogroup" aria-labelledby="pg-mode-l">
              <button type="button" role="radio" className="pill" aria-checked={mode === "LIVE"} disabled={!st.liveAvailable} onClick={() => setMode("LIVE")} title={st.liveAvailable ? "Real PayPal Sandbox calls; you approve holds in a PayPal window" : "PayPal Sandbox credentials are not set on this server"}>Live PayPal Sandbox</button>
              <button type="button" role="radio" className="pill" aria-checked={mode === "MOCK"} onClick={() => setMode("MOCK")} title="Deterministic mock rail, under 200 ms per action">Fast mock</button>
            </div>
          </div>
        </div>
        {!st.liveAvailable && <p className="small muted">Live PayPal Sandbox is off on this server (no sandbox credentials), so scenarios run on the deterministic mock rail.</p>}
        <div className="grid-cards">
          {st.scenarios.map((s) => {
            const visible = busy === `start-${s.id}` ? "Starting…" : sim?.scenario === s.id ? "Start again" : "Start";
            return (
              <article key={s.id} id={`pg-scn-${s.id}`} className="pg-card" data-on={sim?.scenario === s.id || focus === s.id ? "" : undefined} aria-current={focus === s.id ? "true" : undefined}>
                <div className="row"><span className="chip" data-b="plain">{s.id}</span><span className="small muted">~{s.seconds} s · {s.steps} steps</span></div>
                <h3>{s.title}</h3>
                <p className="small">{s.proves}</p>
                {/* WCAG 2.5.3 (label in name): the accessible name starts with the visible text. */}
                <button type="button" className="btn btn-sm btn-g" disabled={!!busy} onClick={() => start(s.id)} aria-label={`${visible} — scenario ${s.id}: ${s.title}, ${mode === "LIVE" ? "live PayPal Sandbox" : "fast mock"} mode`}>
                  {visible}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <div aria-live="polite" className="pg-live">{msg && <p className="notice" data-b={msg.tone}>{msg.text}</p>}</div>

      {sim && current && (
        <>
          <section className="c pg-bar" aria-label="Session controls">
            <div className="row">
              <span className="pg-sim-badge" role="status">Simulated time · day {sim.day} · {new Date(sim.simulatedNow).toUTCString().slice(5, 22)} UTC</span>
              <span className="chip" data-b={sim.mode === "LIVE" ? "ok" : "plain"}>{sim.mode === "LIVE" ? "Live PayPal Sandbox" : "Fast mock rail (simulated)"}</span>
              <span className="chip" data-b="plain">{current.id} · {current.title}</span>
              {sim.faults.map((f) => <span key={f} className="chip" data-b="warn">fault: {f}</span>)}
              <span className="sp" />
              <button type="button" className="btn btn-sm" onClick={refresh} disabled={!!busy}>Refresh</button>
              <button type="button" className="btn btn-sm" onClick={reset} disabled={!!busy}>{busy === "reset" ? "Resetting…" : "Reset to day 0"}</button>
            </div>
          </section>

          <div className="pg-two">
            <section className="c" aria-labelledby="pg-steps">
              <div className="c-head">
                <h2 id="pg-steps">2 · Run the steps</h2>
                <div className="r">
                  <button type="button" className="btn btn-sm btn-g" onClick={() => runNext()} disabled={!!busy || !st.next}>{busy === "run" ? "Running…" : "Run next step"}</button>
                  <button type="button" className="btn btn-sm" onClick={runAll} disabled={!!busy || !st.next}>{busy === "all" ? "Running all…" : "Run all"}</button>
                </div>
              </div>
              <ol className="pg-steps">
                {st.steps.map((s, i) => (
                  <li key={s.id} className="pg-step" data-s={s.status} aria-current={st.next === s.id ? "step" : undefined}>
                    <span className="pg-ic" aria-hidden="true">{STATUS[s.status]?.icon ?? "○"}</span>
                    <div className="pg-step-b">
                      <div className="row"><b>{i + 1}. {s.label}</b><span className="sr-only">— {STATUS[s.status]?.label}</span><span className="small muted">{s.whoName}</span></div>
                      <p className="small muted">{s.explain}</p>
                      {s.detail && <p className="small pg-detail">{s.detail}</p>}
                      <div className="row">
                        {s.link && <a className="btn btn-sm" href={s.link} target="_blank" rel="noopener noreferrer">{sim.mode === "LIVE" ? "Open PayPal approval" : "Open approval link (simulated)"}</a>}
                        {(s.status === "waiting" || s.status === "error") && <button type="button" className="btn btn-sm btn-gh" disabled={!!busy} onClick={() => runNext(s.id)}>Run this step again</button>}
                        {s.simDay !== null && <span className="small muted">at simulated day {s.simDay}{s.ms !== null ? ` · ${s.ms} ms` : ""}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <div className="stack">
              <section className="c" aria-labelledby="pg-time">
                <div className="c-head"><h2 id="pg-time">Time machine</h2><span className="chip" data-b="warn">Simulated time</span></div>
                <p className="small muted">Moves only this session&apos;s virtual clock, then runs the hold watchdog and review timers. Real time and real money are untouched.</p>
                <label className="field" htmlFor="pg-day">
                  <span className="lab">Go to simulated day <b>{day}</b> (now day {sim.day})</span>
                  <input id="pg-day" type="range" min={0} max={28} step={1} value={day} list="pg-marks" onChange={(e) => setDay(Math.max(minDay, Number(e.target.value)))} aria-valuetext={`day ${day}`} />
                </label>
                <datalist id="pg-marks">{MARKS.map((m) => <option key={m} value={m} label={`day ${m}`} />)}</datalist>
                {/* Day numbers only, staggered on two rows so close marks never overlap; the key below names them. */}
                <div className="pg-ticks" aria-hidden="true">{MARKS.map((m, i) => <span key={m} style={{ left: `${(m / 28) * 100}%` }} data-row={i % 2 ? "2" : "1"} data-edge={i === 0 ? "start" : i === MARKS.length - 1 ? "end" : undefined} data-k={[22, 25, 27, 28].includes(m) ? "" : undefined}>{m}</span>)}</div>
                <p className="small muted pg-tick-key">Day 22: hold warning · day 25: rollover offered · day 27: settlement · day 28: hold window ends.</p>
                <div className="row">
                  <button type="button" className="btn btn-sm btn-g" disabled={!!busy || day <= sim.day} onClick={() => travel({ toDay: day })}>{busy === "time" ? "Travelling…" : `Travel to day ${day}`}</button>
                  <button type="button" className="btn btn-sm" disabled={!!busy || sim.offsetHours + 48 > 720} onClick={() => travel({ hours: 48 })}>+48 h</button>
                  {[22, 25, 27].map((d) => <button key={d} type="button" className="btn btn-sm" disabled={!!busy || sim.day >= d} onClick={() => travel({ toDay: d })}>Day {d}</button>)}
                </div>
              </section>

              <section className="c" aria-labelledby="pg-chaos">
                <div className="c-head"><h2 id="pg-chaos">Chaos injector</h2><span className="chip" data-b="warn">Simulated faults</span></div>
                <div className="pg-faults">
                  {FAULTS.map((f) => (
                    <button key={f.id} type="button" className="btn btn-sm" disabled={!!busy || (f.mockOnly && sim.mode === "LIVE")} onClick={() => fault(f.id)} title={f.mockOnly && sim.mode === "LIVE" ? "Mock rail only" : f.hint}>
                      <span>{busy === `fault-${f.id}` ? "Injecting…" : f.label}</span><small>{f.hint}</small>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>

          <div className="pg-quad" aria-label="Four views of the same contract">
            <Q1 st={st} />
            <Q2 st={st} />
            <Q3 st={st} />
            <section className="c pg-q" aria-labelledby="pg-q4">
              <div className="c-head"><h2 id="pg-q4">Q4 · Wire log</h2><span className="chip" data-b={sim.mode === "LIVE" ? "ok" : "warn"}>{sim.mode === "LIVE" ? "PayPal Sandbox" : "Mock rail (simulated)"}</span></div>
              {st.wire.length === 0 ? <p className="small muted">Rail calls, webhooks and MCP calls of this session appear here.</p> : (
                <ol className="pg-wire" ref={wireRef}>
                  {st.wire.map((w) => (
                    <li key={w.id} data-k={w.kind} data-ok={w.ok ? undefined : "no"}>
                      <span className="pg-wk">{w.kind}</span>
                      <span className="pg-wd small muted">d{w.day}</span>
                      <div><code>{w.request}</code><span className="small">{w.response}</span></div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <TamperPanel sim={sim} busy={!!busy} onState={(s) => { apply(s); setMsg({ tone: "ok", text: "Fresh session at simulated day 0 after the repair. The old contract and its audit rows are left as they were." }); }} />
        </>
      )}

      <PairPanel initial={pair ?? null} busy={!!busy} />
    </div>
  );
}

function Waiting({ text }: { text: string }) { return <p className="notice small" data-b="warn">{text}</p>; }

function Q1({ st }: { st: PlaygroundState }) {
  const c = st.client;
  return (
    <section className="c pg-q" aria-labelledby="pg-q1">
      <div className="c-head"><h2 id="pg-q1">Q1 · Client view</h2>{c?.clientName && <span className="small muted">{c.clientName}</span>}</div>
      {!c ? <p className="small muted">No contract yet. Run the first step.</p> : c.waiting ? <Waiting text={c.waiting} /> : (
        <>
          <dl className="kv">
            <div><dt>Contract</dt><dd>{c.title}<small>{c.blueprint} · revision {c.revision} · risk {c.risk}</small></dd></div>
            <div><dt>Total</dt><dd className="money">{usd(c.totalCents ?? 0)}</dd></div>
            <div><dt>State</dt><dd><span className={`state ${stateClass(c.state ?? "")}`}>{c.state}</span></dd></div>
            <div><dt>Signatures</dt><dd>{c.signatures?.length ? c.signatures.map((s) => `${s.role} r${s.revNo}${s.voided ? " (voided)" : ""}`).join(" · ") : "none yet"}</dd></div>
          </dl>
          <table className="ptable">
            <caption className="sr-only">Where the money is, per tranche</caption>
            <thead><tr><th>Tranche</th><th>State</th><th className="n">Held in PayPal</th><th className="n">Released</th><th className="n">Returned</th></tr></thead>
            <tbody>
              {(c.tranches ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{t.idx}<div className="small muted">days {t.startDay}–{t.endDay} · {usd(t.amountCents)}</div></td>
                  <td><span className={`state ${stateClass(t.state)}`}>{t.state}</span></td>
                  <td className="n money">{usd(t.heldCents)}</td><td className="n money">{usd(t.releasedCents)}</td><td className="n money">{usd(t.returnedCents)}</td>
                </tr>
              ))}
              {!c.tranches?.length && <tr><td colSpan={5} className="small muted">Tranches appear when the contract locks.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function Q2({ st }: { st: PlaygroundState }) {
  const p = st.provider;
  return (
    <section className="c pg-q" aria-labelledby="pg-q2">
      <div className="c-head"><h2 id="pg-q2">Q2 · Provider view</h2>{p?.name && <span className="small muted">{p.name}</span>}</div>
      {!p ? <p className="small muted">No contract yet.</p> : p.waiting ? <Waiting text={p.waiting} /> : (
        <>
          <ul className="pg-ms">
            {(p.milestones ?? []).map((m) => (
              <li key={m.code}><span className="pg-code">{m.code}</span><span className="pg-mt">{m.title}<small className="muted"> · day {m.targetDay} · {m.type === "GATE" ? "gate" : usd(m.amountCents)}</small></span><span className={`state ${stateClass(m.state)}`}>{m.state}</span></li>
            ))}
          </ul>
          <h3 className="pg-h3">Payouts <span className="small muted">· provider has netted {usd(p.netCents ?? 0)}</span></h3>
          {p.payouts?.length ? (
            <table className="ptable">
              <thead><tr><th>Milestone</th><th className="n">Gross</th><th className="n">Fee</th><th className="n">Net</th><th>Status</th></tr></thead>
              <tbody>{p.payouts.map((x, i) => <tr key={i}><td>{x.code}{x.kind === "VERDICT" ? " (verdict)" : ""}<div className="small muted">{x.ref ?? ""}</div></td><td className="n money">{usd(x.grossCents)}</td><td className="n money">{usd(x.feeCents)}</td><td className="n money">{usd(x.netCents)}</td><td><span className={`state ${stateClass(x.status)}`}>{x.status}</span></td></tr>)}</tbody>
            </table>
          ) : <p className="small muted">No payouts yet.</p>}
        </>
      )}
    </section>
  );
}

function Q3({ st }: { st: PlaygroundState }) {
  const l = st.ledger;
  const verdictTone = (v: string) => (v === "CLEAN" ? "ok" : v === "IN_FLIGHT" ? "warn" : "danger");
  return (
    <section className="c pg-q" aria-labelledby="pg-q3">
      <div className="c-head"><h2 id="pg-q3">Q3 · Ledger and reconciliation</h2></div>
      {!l ? <p className="small muted">The ledger fills when money is held.</p> : (
        <>
          {l.waiting && <Waiting text={l.waiting} />}
          <div className="row">
            {Object.entries(l.totals).map(([k, v]) => <span key={k} className="chip" data-b="plain">{k} {usd(v)}</span>)}
            {l.recon ? (l.recon.mine || l.recon.verdict === "CLEAN" ? <span className="chip" data-b={verdictTone(l.recon.verdict)}>Recon {l.recon.verdict} · {l.recon.matched} matched{l.recon.mine ? ` · ${l.recon.mine} exception(s) here` : ""}</span> : <span className="chip" data-b={verdictTone("CLEAN")} title={`Latest platform-wide run: ${l.recon.verdict}, ${l.recon.matched} matched; its exceptions are on other contracts`}>Recon: no exceptions in this scenario</span>) : <span className="chip" data-b="none">No reconciliation run yet</span>}
          </div>
          {l.recon?.exceptions.length ? <ul className="small pg-ex">{l.recon.exceptions.map((x, i) => <li key={i}>{x.plane}: expected {usd(x.expected)}, found {usd(x.actual)} — {x.note}</li>)}</ul> : null}
          {l.rows.length ? (
            <div className="tbwrap pg-scroll">
              <table className="ptable">
                <thead><tr><th>Type</th><th>Debit → credit</th><th className="n">Amount</th><th>Ref</th></tr></thead>
                <tbody>{l.rows.map((r, i) => <tr key={i} data-sim={r.paypalRef?.startsWith("SIM-") ? "" : undefined}><td>{r.type}<div className="small muted">t{r.tranche}{r.milestone ? ` · ${r.milestone}` : ""}</div></td><td className="small">{r.debit} → {r.credit}</td><td className="n money">{usd(r.amountCents)}</td><td className="small muted">{r.paypalRef ?? ""}{r.paypalRef?.startsWith("SIM-") ? " (simulated drift)" : ""}</td></tr>)}</tbody>
              </table>
            </div>
          ) : !l.waiting && <p className="small muted">No ledger rows yet.</p>}
        </>
      )}
    </section>
  );
}
