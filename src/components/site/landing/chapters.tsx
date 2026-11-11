/**
 * F3 · the landing chapters, in reading order: the problem (two-sided risk), how it works, disputes that freeze one
 * milestone, AI that advises, agents with a human gate, built on PayPal, trust, and the honest limits.
 * Scenes are marked data-scene and parts are marked for
 * motion.tsx; all copy and art are PaySettle's. Every scene is complete without script: motion only adds entrances.
 */
import type { CSSProperties } from "react";
import { site, siteMoney } from "@/copy/site";
import { WEB_MVP } from "@/data/blueprints/digital";
import { lintCriterion } from "@/lib/ai/rules";
import type { LandingFacts } from "./facts";
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

/* ── how it works: six steps, and a published blueprint split into money ── */
export function How({ facts }: { facts: LandingFacts }) {
  const t = site.landing.how;
  const ex = facts.example;
  /* An illustration of the blueprint mid-way: the gate passed, two milestones released, the rest held. */
  const stateOf = (i: number, type: string) => (type === "GATE" ? "gate" : i <= 2 ? "released" : "held");
  return (
    <section id="how" className="lp-scene lp-how" data-scene="how" aria-labelledby="lp-how-h">
      <div className="lp-wrap lp-flow-split">
        <div className="lp-flow-text">
          <p className="lp-kicker" data-part>{t.kicker}</p>
          <h2 id="lp-how-h" data-part>{t.title}</h2>
          <ol className="lp-steps">
            {t.steps.map((st, i) => (
              <li key={st.head} data-part style={{ "--i": i } as CSSProperties}>
                <span className="lp-step-n" aria-hidden="true">{i + 1}</span>
                <div><b>{st.head}</b><p>{st.body}</p></div>
              </li>
            ))}
          </ol>
        </div>
        {ex && (
          <figure className="lp-contract" data-part data-depth="-0.07">
            <figcaption className="lp-contract-head">
              <b>{t.example(ex.title, ex.days)}</b>
              <span className="lp-pill">{t.total(ex.totalCents)}</span>
            </figcaption>
            <ol className="lp-ms">
              {ex.milestones.map((m, i) => {
                const s = stateOf(i, m.type);
                return (
                  <li key={m.code} data-row style={{ "--i": i } as CSSProperties}>
                    <span className="lp-ms-code">{m.code}</span>
                    <span className="lp-ms-title"><b>{m.title}</b><small>Day {m.day}{m.type === "GATE" ? ` · ${t.gate}` : ` · ${pctOf(m.bps)}`}</small></span>
                    <span className="lp-ms-amt tnum">{m.type === "GATE" ? "—" : siteMoney(m.amountCents)}</span>
                    {s === "gate" ? <span className="state draft">Gate</span> : <span className={`state ${s}`}>{s === "released" ? t.released : t.held}</span>}
                  </li>
                );
              })}
            </ol>
            <p className="lp-caption">{t.exampleNote(facts.blueprints, ex.milestones.length)}</p>
          </figure>
        )}
      </div>
    </section>
  );
}

/* ── disputes: one milestone frozen, the rest carry on ── */
export function Disputes() {
  const t = site.landing.disputes;
  const strip = [
    { code: "M02", s: "released" }, { code: "M03", s: "released" }, { code: "M04", s: "disputed" }, { code: "M05", s: "held" }, { code: "M06", s: "held" },
  ] as const;
  const label = { released: t.strip.released, disputed: t.strip.frozen, held: t.strip.held };
  return (
    <section id="disputes" className="lp-scene lp-disputes" data-scene="disputes" aria-labelledby="lp-disputes-h">
      <div className="lp-wrap">
        <Head id="lp-disputes-h" kicker={t.kicker} title={t.title} lead={t.lead} />
        <ol className="lp-strip" aria-label="Five milestones of one contract">
          {strip.map((m, i) => (
            <li key={m.code} className={`lp-strip-${m.s}`} data-part style={{ "--i": i } as CSSProperties}>
              <b>{m.code}</b><span className={`state ${m.s}`}>{label[m.s]}</span>
            </li>
          ))}
        </ol>
        <ol className="lp-tiers">
          {t.tiers.map((tier, i) => (
            <li key={tier.head} data-part style={{ "--i": i } as CSSProperties}>
              <span className="lp-step-n" aria-hidden="true">{i + 1}</span>
              <div><b>{tier.head}</b><p>{tier.body}</p></div>
            </li>
          ))}
        </ol>
        <p className="lp-caption" data-part>{t.split}</p>
      </div>
    </section>
  );
}

/* ── AI: four advisers and one human gate ── */
export function Ai() {
  const t = site.landing.ai;
  return (
    <section id="ai" className="lp-scene lp-ai" data-scene="ai" aria-labelledby="lp-ai-h">
      <div className="lp-wrap">
        <Head id="lp-ai-h" kicker={t.kicker} title={t.title} lead={t.lead} />
        <div className="lp-ai-grid">
          <ul className="lp-ai-roles">
            {t.roles.map((r, i) => (
              <li key={r.name} data-part style={{ "--i": i } as CSSProperties}>
                <div className="lp-ai-top"><b>{r.name}</b><span className="chip" data-b="plain">{t.advises}</span></div>
                <p>{r.body}</p>
              </li>
            ))}
          </ul>
          <div className="lp-gatecard" data-part>
            <div className="lp-compile" aria-label="Criteria Compiler example">
              <p><s>{"“Make it fast”"}</s></p>
              <span aria-hidden="true">{"↓"}</span>
              <p><b>Lighthouse mobile score {"≥"} 85 on the staging address</b></p>
            </div>
            <div className="lp-gate-row"><span className="lp-yes" aria-hidden="true"><Tick /></span><div><b>{t.gate.title}</b><p>{t.gate.body}</p></div></div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── agents: MCP calls, with the steps that stop for a person ── */
export function Agents() {
  const t = site.landing.agents;
  return (
    <section id="agents" className="lp-scene lp-agents" data-scene="agents" aria-labelledby="lp-agents-h">
      <div className="lp-wrap lp-flow-split lp-flow-flip">
        <div className="lp-flow-text">
          <p className="lp-kicker" data-part>{t.kicker}</p>
          <h2 id="lp-agents-h" data-part>{t.title}</h2>
          <p className="lp-lead lp-lead-left" data-part>{t.lead}</p>
        </div>
        <ol className="lp-term" data-part data-depth="-0.05" aria-label="An agent-to-agent contract, call by call">
          {t.calls.map((c, i) => (
            <li key={c.tool} className={c.gate ? "lp-term-gate" : undefined} data-row style={{ "--i": i } as CSSProperties}>
              <span className="lp-term-who">{c.who}</span>
              <code>{c.tool}</code>
              <span className="lp-term-note">{c.note}</span>
              {c.gate && <span className="chip" data-b="grad">{t.gateLabel}</span>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── PayPal: one authorization, partial captures, the remainder voided ── */
export function OnPaypal({ facts }: { facts: LandingFacts }) {
  const t = site.landing.paypal;
  const ms = facts.example?.milestones.filter((m) => m.type === "PAY") ?? [];
  const total = facts.example?.totalCents ?? 600_000;
  /* the first two paid milestones captured, the last one not needed (voided back), the rest still held */
  const parts = ms.map((m, i) => ({ ...m, s: i < 2 ? "captured" : i === ms.length - 1 ? "voided" : "held" }));
  const sum = (s: string) => parts.filter((p) => p.s === s).reduce((a, p) => a + p.amountCents, 0);
  return (
    <section id="paypal" className="lp-scene lp-paypal" data-scene="paypal" aria-labelledby="lp-paypal-h">
      <div className="lp-wrap">
        <Head id="lp-paypal-h" kicker={t.kicker} title={t.title} lead={t.lead} />
        {parts.length > 0 && (
          <div className="lp-auth" data-part data-depth="-0.05">
            <div className="lp-auth-bar" role="img" aria-label={t.art(siteMoney(total))}>
              {parts.map((p, i) => (
                <span key={p.code} className={`lp-auth-seg lp-auth-${p.s}`} data-bar style={{ flexGrow: p.amountCents, "--i": i } as CSSProperties}>
                  <b>{p.code}</b><small className="tnum">{siteMoney(p.amountCents)}</small>
                </span>
              ))}
            </div>
            <ul className="lp-auth-key">
              <li><i className="lp-auth-captured" aria-hidden="true" />{t.bar.captured}<b className="tnum">{siteMoney(sum("captured"))}</b></li>
              <li><i className="lp-auth-held" aria-hidden="true" />{t.bar.authorized}<b className="tnum">{siteMoney(sum("held"))}</b></li>
              <li><i className="lp-auth-voided" aria-hidden="true" />{t.bar.voided}<b className="tnum">{siteMoney(sum("voided"))}</b></li>
            </ul>
          </div>
        )}
        <ul className="lp-facts">
          {t.facts.map((f, i) => (
            <li key={f.head} data-part style={{ "--i": i } as CSSProperties}><b>{f.head}</b><p>{f.body}</p></li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── trust: the audit chain, reconciliation, four-eyes, sealed revisions ── */
export function Trust({ facts }: { facts: LandingFacts }) {
  const t = site.landing.trust;
  return (
    <section id="trust" className="lp-scene lp-trust" data-scene="trust" aria-labelledby="lp-trust-h">
      <div className="lp-wrap">
        <Head id="lp-trust-h" kicker={t.kicker} title={t.title} lead={t.lead} />
        <ol className="lp-chain">
          {t.items.map((it, i) => (
            <li key={it.head} data-part style={{ "--i": i } as CSSProperties}>
              <span className="lp-chain-link" aria-hidden="true"><Tick /></span>
              <div><b>{it.head}</b><p>{it.body}</p></div>
            </li>
          ))}
        </ol>
        <p className="lp-live" data-part>
          <span><i aria-hidden="true" />{t.live.audit(facts.auditRows)}</span>
          <span><i aria-hidden="true" />{t.live.recon(facts.recon)}</span>
        </p>
      </div>
    </section>
  );
}

/* ── honest limits, said once at full size ── */
export function Limits() {
  const t = site.landing.limits;
  return (
    <section className="lp-not" data-scene="not" aria-labelledby="lp-not-h">
      <div className="lp-wrap">
        <div className="lp-not-card">
          <h2 id="lp-not-h" data-part>{t.title}</h2>
          <div className="lp-not-list">
            <ul>{t.not.map((l, i) => <li key={l} data-part style={{ "--i": i } as CSSProperties}><span className="lp-no" aria-hidden="true" />{l}</li>)}</ul>
            <p className="lp-not-is" data-part><span className="lp-yes" aria-hidden="true"><Tick /></span>{t.is}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
