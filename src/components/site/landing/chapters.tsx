/**
 * F3 · the landing chapters that stay as cards: the contract compiler and the problem (two-sided risk). The later
 * chapters are motion scenes (scenes.tsx, PaypalScene.tsx).
 * Scenes are marked data-scene and parts are marked for
 * motion.tsx; all copy and art are PaySettle's. Every scene is complete without script: motion only adds entrances.
 */
import type { CSSProperties } from "react";
import { site } from "@/copy/site";
import { WEB_MVP } from "@/data/blueprints/digital";
import { lintCriterion } from "@/lib/ai/rules";
import { AMBER, TEAL } from "./hero";

const pctOf = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

function Head({ id, kicker, title, lead }: { id: string; kicker?: string; title: string; lead?: string }) {
  return (
    <header className="lp-head" data-part>
      {kicker && <p className="lp-kicker">{kicker}</p>}
      <h2 id={id}>{title}</h2>
      {lead && <p className="lp-lead">{lead}</p>}
    </header>
  );
}

const Tick = () => <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/* ── the contract compiler: one vague criterion, rejected and rewritten by the real linter, then the signed clause ── */
export function Compiler() {
  const t = site.landing.compiler;
  const verdict = lintCriterion(t.before);
  const clause = WEB_MVP.milestones.find((m) => m.code === "M05");
  return (
    <section id="compiler" className="lp-scene lp-how" data-scene="compiler" aria-labelledby="lp-compiler-h">
      <div className="lp-wrap lp-flow-split">
        <div className="lp-flow-text">
          <p className="lp-kicker" data-part>{t.kicker}</p>
          <h2 id="lp-compiler-h" data-part>{t.title}</h2>
          <ol className="lp-steps">
            {t.steps.map((st, i) => (
              <li key={st.head} data-part style={{ "--i": i } as CSSProperties}>
                <span className="lp-step-n" aria-hidden="true">{i + 1}</span>
                <div><b>{st.head}</b><p>{st.body}</p></div>
              </li>
            ))}
          </ol>
        </div>
        <div className="lp-gatecard" data-part data-depth="-0.06">
          <div className="lp-compile" aria-label="Criteria Compiler: a vague criterion and its rewrite">
            <p><s>{`“${t.before}”`}</s></p>
            <p><span className="chip" data-b="danger">{verdict.verifiable ? "Checkable" : t.rejected}</span> {verdict.reason}</p>
            <span aria-hidden="true">{"↓"}</span>
            {verdict.rewrite && <p>{t.rewrite}: <b>{verdict.rewrite}</b></p>}
          </div>
          {clause && (
            <div className="lp-gate-row">
              <span className="lp-yes" aria-hidden="true"><Tick /></span>
              <div>
                <b>{t.signed}: {clause.proof.criteria[0]}</b>
                <p>{t.proof}: {clause.proof.artifacts.map((a) => a.note ?? a.kind).join(", ")}. {t.share(pctOf(clause.bps), `${WEB_MVP.title}, ${clause.code}`)}</p>
              </div>
            </div>
          )}
          <p className="lp-caption" style={{ color: "#b4bac2", textAlign: "left", marginTop: 0 }}>{t.note}</p>
        </div>
      </div>
    </section>
  );
}

/* ── the problem: two lines that run side by side and never meet ── */
function wave(y: number, amp: number, phase: number) {
  let d = `M-40 ${y}`;
  for (let x = -40; x <= 1280; x += 20) d += ` L${x} ${Math.round((y + amp * Math.sin((x / 1240) * Math.PI * 3 + phase)) * 10) / 10}`;
  return d;
}

export function Problem() {
  const t = site.landing.problem;
  const legend = [
    { key: "client", color: TEAL, ...t.client },
    { key: "both", color: "#ffffff", ...t.both },
    { key: "provider", color: AMBER, ...t.provider },
  ];
  return (
    <section id="problem" className="lp-scene lp-problem" data-scene="problem" aria-labelledby="lp-problem-h">
      <div className="lp-wrap">
        <Head id="lp-problem-h" kicker={t.kicker} title={t.title} lead={t.lead} />
        <div className="lp-stage" data-part>
          <svg className="lp-apart" data-depth="0.08" viewBox="0 0 1240 520" role="img" aria-label={t.art}>
            <path className="lp-line" pathLength={1} d={wave(170, 34, 0)} stroke={TEAL} />
            <path className="lp-line" pathLength={1} d={wave(350, 34, Math.PI)} stroke={AMBER} />
            <line x1="620" y1="214" x2="620" y2="306" stroke="#4e545c" strokeWidth="2" strokeDasharray="6 7" />
          </svg>
          <span className="lp-tag lp-tag-a"><i style={{ background: TEAL }} />{t.client.title}</span>
          <span className="lp-tag lp-tag-b"><i style={{ background: AMBER }} />{t.provider.title}</span>
          <span className="lp-tag lp-tag-gap">{"“Done” = a sentence in an e-mail"}</span>
        </div>
        <ul className="lp-legend">
          {legend.map((l) => (
            <li key={l.key} className={`lp-legend-item lp-ink-${l.key}`} data-part>
              <i aria-hidden="true" style={{ "--dot": l.color } as CSSProperties} />
              <div><b>{l.title}</b><p>{l.body}</p></div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
