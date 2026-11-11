"use client";
/**
 * Playground extras (A6 "Try to cheat" — edit history, watch the hash-chain verifier catch it, repair by
 * reset — and A12 Pair A vs Pair B — two contracts from one blueprint, side by side. Sandbox only; every element is
 * labelled as simulated. Talks to the server actions in src/app/(app)/playground/actions.ts.
 */
import { useId, useState } from "react";
import type { PlaygroundState } from "@/server/playground/state";
import type { TamperState } from "@/server/playground/tamper";
import type { PairResult } from "@/server/playground/pairs";
import type { PairCell, PairSide } from "@/server/playground/pairs-diff";
import { auditCopyAction, buildPairsAction, directEditAction, repairAction, tamperAction, type ExtrasResult } from "@/app/(app)/playground/actions";
import "@/styles/playground-extras.css";

const usd = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
const short = (h: string) => `${h.slice(0, 10)}…`;
type Tone = "ok" | "warn" | "danger";

/* ── A6 Try to cheat ── */

export function TamperPanel({ sim, busy, onState }: { sim: NonNullable<PlaygroundState["sim"]>; busy: boolean; onState: (s: PlaygroundState) => void }) {
  const [state, setState] = useState<TamperState | null>(null);
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [seq, setSeq] = useState<string>("");
  const ids = useId();
  const off = busy || !!working;
  const forSim = state && state.simId === sim.id ? state : null;

  async function go<T>(label: string, fn: () => Promise<ExtrasResult<T>>, after: (d: T) => { tone: Tone; text: string }) {
    setWorking(label); setMsg(null);
    try { const r = await fn(); if (r.ok) setMsg(after(r.data)); else setMsg({ tone: "danger", text: r.message }); }
    catch { setMsg({ tone: "danger", text: "The request did not reach the server. Try again." }); }
    finally { setWorking(null); }
  }
  const verdict = (s: TamperState): { tone: Tone; text: string } => s.ok ? { tone: "ok", text: s.explanation } : { tone: "danger", text: `Tampering detected. ${s.explanation}` };
  const load = () => go("load", () => auditCopyAction(sim.id), (s) => { setState(s); return verdict(s); });
  const direct = () => go("direct", () => directEditAction(sim.id), (d) => { setState(d.state); return { tone: d.attempt.refused ? "ok" : "warn", text: `Direct edit of row #${d.attempt.seq} in the real audit log: ${d.attempt.message}` }; });
  const tamper = (mode: "edit" | "rehash") => go(mode, () => tamperAction({ simId: sim.id, mode, seq: seq ? Number(seq) : undefined }), (d) => { setState(d.state); return { tone: d.state.ok ? "warn" : "danger", text: `You changed ${d.change}. ${d.state.ok ? "The verifier did not notice — report this." : `The verifier caught it. ${d.state.explanation}`}` }; });
  const repair = () => go("repair", () => repairAction(sim.id), (s) => { onState(s); setState(null); setSeq(""); return { tone: "ok", text: "Repaired: the copy is gone and the scenario was reset to a fresh session at day 0. Run the steps again to rebuild its history." }; });

  return (
    <section className="c pgx-tamper" aria-labelledby={`${ids}-h`}>
      <div className="c-head">
        <h2 id={`${ids}-h`}>Try to cheat</h2>
        <span className="chip" data-b="warn">Simulation only</span>
      </div>
      <p className="small">
        Every action in PaySettle is written to a hash-chained audit log: each row stores the hash of the row before it. Try to rewrite
        this simulation&apos;s history and watch the verifier find the exact row. Only this simulation&apos;s rows can be touched; the real log
        refuses edits.
      </p>
      {!sim.workspaceId ? (
        <p className="small muted">Run the first step so the simulation has a contract and an audit trail, then come back here.</p>
      ) : (
        <>
          <ol className="pgx-steps small">
            <li><b>Edit the real log directly.</b> A SQL <code>UPDATE</code> on one of this simulation&apos;s rows; the database trigger refuses it.</li>
            <li><b>Edit a copied row.</b> Rows are copied into a sandbox table; one amount is changed.</li>
            <li><b>Edit and re-hash.</b> The cheater also recomputes the row&apos;s own hash; the next row still points at the old one.</li>
          </ol>
          <div className="row pgx-actions">
            <button type="button" className="btn btn-sm" disabled={off} onClick={load}>{working === "load" ? "Verifying…" : "Copy and verify the rows"}</button>
            <button type="button" className="btn btn-sm" disabled={off} onClick={direct}>{working === "direct" ? "Trying…" : "1 · Edit the real log"}</button>
            <button type="button" className="btn btn-sm btn-g" disabled={off} onClick={() => tamper("edit")}>{working === "edit" ? "Editing…" : "2 · Edit a copied row"}</button>
            <button type="button" className="btn btn-sm btn-g" disabled={off} onClick={() => tamper("rehash")}>{working === "rehash" ? "Editing…" : "3 · Edit and re-hash"}</button>
            <button type="button" className="btn btn-sm btn-gh" disabled={off} onClick={repair}>{working === "repair" ? "Resetting…" : "Repair (reset scenario)"}</button>
          </div>
          {forSim && forSim.rows.length > 0 && (
            <div className="field pgx-pick">
              <label htmlFor={`${ids}-seq`}>Row to edit <span className="muted">(default: a row that carries an amount)</span></label>
              <select id={`${ids}-seq`} value={seq} onChange={(e) => setSeq(e.target.value)} disabled={off}>
                <option value="">Pick for me</option>
                {forSim.rows.map((r) => <option key={r.seq} value={r.seq}>#{r.seq} · {r.action}</option>)}
              </select>
            </div>
          )}
          <div aria-live="polite">{msg && <p className="notice" data-b={msg.tone} role={msg.tone === "danger" ? "alert" : "status"}>{msg.text}</p>}</div>
          {forSim && (
            <>
              <div className="row">
                <span className="chip" data-b={forSim.ok ? "ok" : "danger"}>{forSim.ok ? "Chain verifies" : `Broken at row #${forSim.brokenAt}`}</span>
                <span className="chip" data-b={forSim.realIntact ? "ok" : "danger"}>{forSim.realIntact ? "Real log for this simulation: intact" : "Real log: check failed"}</span>
                <span className="small muted">{forSim.rows.length} rows copied</span>
              </div>
              <div className="tbwrap pgx-scroll">
                <table className="ptable pgx-chain">
                  <caption className="sr-only">This simulation&apos;s audit rows (sandbox copy) and the verifier&apos;s result for each</caption>
                  <thead><tr><th scope="col">Row</th><th scope="col">Action</th><th scope="col">Hash</th><th scope="col">Points back to</th><th scope="col">Check</th></tr></thead>
                  <tbody>
                    {forSim.rows.map((r) => (
                      <tr key={r.seq} data-broken={r.status !== "ok" ? "" : undefined}>
                        <td className="tnum">#{r.seq}</td>
                        <td>{r.action}<div className="small muted">{r.actorRole ?? "system"} · {r.at.slice(0, 16).replace("T", " ")}</div>{r.tampered && <div className="small pgx-edit">Edited: {r.tampered}</div>}</td>
                        <td className="small pgx-hash"><code title={r.hash}>{short(r.hash)}</code></td>
                        <td className="small pgx-hash"><code title={r.prevHash}>{short(r.prevHash)}</code></td>
                        <td className="small">{r.status === "ok" ? <span className="pgx-ok">✓ Verifies</span> : <span className="pgx-bad"><b>✗ {r.status === "content" ? "Contents changed" : "Chain link broken"}</b><br />{r.why}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/* ── A12 Pair A vs Pair B ── */

function Cell({ c, base }: { c: PairCell | null; base: { day: number; bps: number } }) {
  if (!c) return <td className="small muted">—</td>;
  if (!c.active) return <td><span className="chip" data-b="warn">Pruned</span></td>;
  return (
    <td className="small" data-changed={c.changed.length ? "" : undefined}>
      <span className="tnum">day {c.day}</span>{c.bps ? <> · <span className="money">{usd(c.amountCents)}</span> ({pct(c.bps)})</> : <> · gate</>}
      {c.changed.includes("day") && <div className="pgx-delta">moved from day {base.day}</div>}
      {c.changed.includes("bps") && <div className="pgx-delta">share {pct(base.bps)} → {pct(c.bps)}</div>}
    </td>
  );
}

function SideCard({ s }: { s: PairSide }) {
  const id = useId();
  return (
    <article className="pgx-side" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>{s.label}</h3>
      <p className="small muted">{s.client} ↔ {s.provider}</p>
      <dl className="kv">
        <div><dt>Total</dt><dd className="money">{usd(s.totalCents)}</dd></div>
        <div><dt>Timeline</dt><dd>{s.days} days · {s.activeMilestones} milestones</dd></div>
        <div><dt>PayPal holds</dt><dd>{s.tranches.map((t) => `${usd(t.amountCents)} (days ${t.startDay}–${t.endDay})`).join(" · ")}</dd></div>
        <div><dt>Fee and payout</dt><dd>Fee {usd(s.feeCents)} on releases · provider nets {usd(s.providerNetCents)}</dd></div>
        <div><dt>Edits</dt><dd>{s.pruned.length} pruned · {s.appended.length} appended · {s.moved} re-dated · {s.reweighted} re-weighted · revision {s.revision}</dd></div>
        <div><dt>Clauses</dt><dd>{[...s.clausesOff.map((c) => `off: ${c}`), ...s.clausesAdded.map((c) => `added: ${c}`)].join(" · ") || "as in the blueprint"}</dd></div>
        <div><dt>Policy gate</dt><dd>{s.violations.length ? s.violations.map((v) => `${v.rule} ${v.message}`).join(" ") : "All rules pass"}</dd></div>
      </dl>
      <details className="pgx-risk">
        <summary>Risk score <b className="tnum">{s.risk}</b> of 100 — why</summary>
        <table className="ptable">
          <caption className="sr-only">Risk score parts for {s.label}</caption>
          <thead><tr><th scope="col">Part</th><th scope="col" className="n">Weight</th><th scope="col" className="n">Value</th><th scope="col" className="n">Points</th></tr></thead>
          <tbody>{s.riskParts.map((p) => <tr key={p.label}><td>{p.label}</td><td className="n tnum">{p.weight}</td><td className="n tnum">{p.value.toFixed(2)}</td><td className="n tnum">{p.points.toFixed(1)}</td></tr>)}</tbody>
        </table>
      </details>
      <a className="btn btn-sm" href={`/contracts/${s.workspaceId}`}>Open {s.label.split(" · ")[0]}</a>
    </article>
  );
}

export function PairPanel({ initial, busy }: { initial: PairResult | null; busy: boolean }) {
  const [pair, setPair] = useState<PairResult | null>(initial);
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null);
  const id = useId();
  async function build() {
    setWorking(true); setMsg(null);
    try {
      const r = await buildPairsAction();
      if (r.ok) { setPair(r.data); setMsg({ tone: "ok", text: `Built both contracts through ${r.data.revisions.A + r.data.revisions.B - 2} recorded changes. Both are unsigned drafts; no money moves.` }); }
      else setMsg({ tone: "danger", text: r.message });
    } catch { setMsg({ tone: "danger", text: "The request did not reach the server. Try again." }); }
    finally { setWorking(false); }
  }
  const d = pair?.diff;
  return (
    <section className="c pgx-pairs" aria-labelledby={`${id}-h`}>
      <div className="c-head">
        <h2 id={`${id}-h`}>Same blueprint, two contracts</h2>
        <span className="chip" data-b="warn">Simulated contracts</span>
      </div>
      <p className="small">
        One classic-car blueprint, two negotiations. <b>Pair A</b> is a purist refresh ($6,000, 18 days): engine mounts, fuel
        injection and dyno tuning pruned; originality record, carburettor rebuild and a period road tune appended. <b>Pair B</b> is
        a track build ($14,500, 28 days): eight inspection checkpoints appended and parts procurement (M06) raised to 35%.
      </p>
      <div className="row">
        <button type="button" className="btn btn-sm btn-g" disabled={busy || working} onClick={build}>{working ? "Building both contracts…" : pair ? "Build a fresh pair" : "Build Pair A and Pair B"}</button>
        {pair && <span className="small muted">Built {pair.createdAt.slice(0, 16).replace("T", " ")} UTC</span>}
      </div>
      <div aria-live="polite">{msg && <p className="notice" data-b={msg.tone} role={msg.tone === "danger" ? "alert" : "status"}>{msg.text}</p>}</div>
      {d && (
        <>
          <div className="pgx-sides">{d.sides.map((s) => <SideCard key={s.key} s={s} />)}</div>
          <div className="tbwrap pgx-scroll pgx-diffwrap">
            <table className="ptable pgx-diff">
              <caption>Blueprint milestones and what each contract did with them</caption>
              <thead><tr><th scope="col">Code</th><th scope="col">Milestone</th><th scope="col">Blueprint</th><th scope="col">{d.sides[0].label}</th><th scope="col">{d.sides[1].label}</th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.code}>
                    <th scope="row" className="tnum">{r.code}</th>
                    <td>{r.title}</td>
                    <td className="small tnum">day {r.base.day} · {r.type === "GATE" ? "gate" : pct(r.base.bps)}</td>
                    <Cell c={r.a} base={r.base} />
                    <Cell c={r.b} base={r.base} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pgx-sides">
            {d.sides.map((s) => (
              <div key={s.key}>
                <h3 className="small">Appended in {s.label}</h3>
                <ul className="pgx-added small">
                  {s.appended.map((a) => <li key={a.code}><span className="chip" data-b="plain">{a.code}</span> {a.title} <span className="muted">· day {a.day} · {a.type === "GATE" ? "checkpoint, no payment" : `${usd(a.amountCents)} (${pct(a.bps)})`}</span></li>)}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
