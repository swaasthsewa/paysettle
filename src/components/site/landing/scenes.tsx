/**
 * F3 · the landing page's motion scenes after "Built on PayPal": trust, AI, agents, disputes, how it works, and what
 * PaySettle is and is not. Server components; each section is marked data-progress, so motion.tsx gives it --p (0 → 1
 * as it scrolls into view) and .is-in while on screen. Every part reads --p against its own window (--a → --b) through
 * the .ph classes in landing-scenes.css; looping parts run only while .is-in. Without script or under reduced motion
 * --p is unset and CSS draws the final state. Few words on purpose: the motion carries the fact, the label names it.
 */
import type { CSSProperties, ReactNode } from "react";
import { EXAMPLE_SHARES } from "./example";
import type { LandingFacts } from "./facts";

/** This part's window on the section's scroll progress. */
const w = (a: number, b: number, extra?: Record<string, string | number>) => ({ "--a": a, "--b": b, ...extra }) as CSSProperties;

function Head({ id, kicker, title }: { id: string; kicker: string; title: ReactNode }) {
  return (
    <header className="sc-head">
      <p className="sc-kicker">{kicker}</p>
      <h2 id={id}>{title}</h2>
    </header>
  );
}

/* small glyphs, 24 × 24, stroke = currentColor */
const G = {
  doc: "M7 3h7l4 4v14H7z M14 3v4h4 M9.5 12h6 M9.5 15.5h6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  list: "M9 7h10 M9 12h10 M9 17h10 M4.5 7l1 1 2-2 M4.5 12l1 1 2-2 M4.5 17l1 1 2-2",
  vault: "M4 5h16v14H4z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M12 9.5V7 M7 19v2 M17 19v2",
  upload: "M12 16V5 M7.5 9.5L12 5l4.5 4.5 M5 19h14",
  shield: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4",
  coin: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 8v8 M14.5 9.5c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.8 0 2.5 5 1.4 5 3.9 0 1.1-1.1 1.8-2.5 1.8-1.2 0-2.2-.5-2.6-1.3",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  key: "M14.5 4a5.5 5.5 0 1 1-4.9 8L4 17.6V20h3v-2h2v-2h2l1.1-1.1A5.5 5.5 0 0 1 14.5 4z M16 8h.01",
  bot: "M8 8h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z M12 4v4 M9.5 13h.01 M14.5 13h.01 M10 16h4",
  person: "M12 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z M5 20a7 6 0 0 1 14 0",
  lock: "M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  snow: "M12 3v18 M4.2 7.5l15.6 9 M4.2 16.5l15.6-9 M9.5 4.5 12 7l2.5-2.5 M9.5 19.5 12 17l2.5 2.5",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z",
  scale: "M12 4v16 M7 20h10 M5 8h14 M5 8l-2.5 6a3 3 0 0 0 5 0z M19 8l-2.5 6a3 3 0 0 0 5 0z",
  pen: "M4 20l4.5-1 10-10-3.5-3.5-10 10z M13.5 7l3.5 3.5",
  env: "M3.5 6.5h17v11h-17z M3.5 7l8.5 6 8.5-6",
};
export function Glyph({ d, className }: { d: string; className?: string }) {
  return <svg className={`sc-g${className ? ` ${className}` : ""}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={d} /></svg>;
}

/* ── Trust: a hash chain that shows tampering, then three ledgers that agree ── */
const CHAIN = [["Signed", "9f2c"], ["Funded", "41ab"], ["Evidence", "c07e"], ["Captured", "d93a"], ["Verdict", "5e18"], ["Receipt", "aa06"]] as const;
export function TrustScene({ facts }: { facts: LandingFacts }) {
  return (
    <section id="trust" className="sc sc-trust" data-progress aria-labelledby="sc-trust-h">
      <div className="lp-wrap">
        <Head id="sc-trust-h" kicker="Trust" title="Every cent has a trail." />
        <ol className="tr2-chain" aria-label="Hash-chained audit log: each row's hash covers the row before it">
          {CHAIN.map(([label, hash], i) => (
            <li key={label} className={`ph ph-pop tr2-block${i === 3 ? " tr2-tamper" : ""}${i > 3 ? " tr2-after" : ""}`} style={w(0.04 + i * 0.05, 0.12 + i * 0.05)}>
              <span className="tr2-label">{label}</span>
              <code className="tr2-hash"><span className="tr2-h1">#{hash}…</span>{i === 3 && <span className="tr2-h2">#ff00…</span>}</code>
              {i > 0 && <Glyph d={G.link} className="tr2-link" />}
            </li>
          ))}
        </ol>
        <p className="ph ph-fade tr2-caught" style={w(0.5, 0.58)}><Glyph d={G.shield} /> One edit breaks every link after it.</p>
        <div className="tr2-recon" aria-label="Three-way reconciliation: PayPal, the ledger and the contract agree">
          {["PayPal", "Ledger", "Contract"].map((n, i) => (
            <div key={n} className="tr2-col">
              <span className="ph ph-grow-y tr2-bar" style={w(0.55 + i * 0.04, 0.75 + i * 0.04)} />
              <span className="tr2-col-n">{n}</span>
              {i < 2 && <span className="ph ph-fade tr2-eq" style={w(0.78, 0.84)} aria-hidden="true">=</span>}
            </div>
          ))}
          <div className="ph ph-pop tr2-zero" style={w(0.82, 0.9)}><Glyph d={G.check} /> zero drift</div>
          <div className="ph ph-pop tr2-keys" style={w(0.86, 0.95)}><Glyph d={G.key} /><Glyph d={G.key} /><span>drift needs two people</span></div>
        </div>
        <p className="sc-live">
          <span><i aria-hidden="true" />{facts.auditRows.toLocaleString("en-US")} rows in this build&apos;s audit chain</span>
          <span><i aria-hidden="true" />{facts.recon === "CLEAN" ? "last reconciliation: zero drift" : facts.recon === "IN_FLIGHT" ? "last reconciliation: matched, releases in flight" : facts.recon === "DRIFT" ? "last reconciliation: drift, contracts stopped" : "no reconciliation run yet"}</span>
        </p>
      </div>
    </section>
  );
}

/* ── AI: four advisers fire at a glass wall; only a person with a second factor gets through ── */
const ROLES = [["Drafter", G.doc], ["Compiler", G.list], ["Verifier", G.check], ["Mediator", G.scale]] as const;
export function AiScene() {
  return (
    <section id="ai" className="sc sc-dark sc-ai" data-progress aria-labelledby="sc-ai-h">
      <div className="lp-wrap">
        <Head id="sc-ai-h" kicker="AI" title={<>AI advises. <em>People decide.</em></>} />
        <div className="ai2-stage">
          <ul className="ai2-roles" aria-label="Four AI roles">
            {ROLES.map(([name, d], i) => (
              <li key={name} className="ph ph-rise" style={w(0.05 + i * 0.06, 0.2 + i * 0.06, { "--i": i })}>
                <span className="ai2-orb"><Glyph d={G.spark} /></span><span className="ai2-name"><Glyph d={d} />{name}</span>
                <span className="ai2-shot" aria-hidden="true" />
              </li>
            ))}
          </ul>
          <div className="ai2-wall" aria-hidden="true"><span>advice only</span></div>
          <div className="ai2-vault">
            <Glyph d={G.lock} />
            <p>Contracts<br />Signatures<br />Ledger</p>
            <span className="ai2-nowrite">AI: no write access</span>
          </div>
          <div className="ai2-person" aria-label="Release needs a person and a second factor">
            <span className="ai2-walker"><Glyph d={G.person} /><code>MFA 427·913</code></span>
            <span className="ai2-release"><Glyph d={G.check} /> release</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Agents: MCP calls between two agents; the two money steps stop for a person ── */
const CALLS = [
  { who: "c", tool: "draft_contract" }, { who: "p", tool: "propose_changes" }, { who: "c", tool: "request_funding" },
  { who: "h", tool: "approves the hold in PayPal" }, { who: "p", tool: "submit_evidence" }, { who: "c", tool: "approve_release" },
  { who: "h", tool: "confirms in the app + MFA" },
] as const;
export function AgentsScene() {
  return (
    <section id="agents" className="sc sc-agents" data-progress aria-labelledby="sc-agents-h">
      <div className="lp-wrap">
        <Head id="sc-agents-h" kicker="Agents · MCP" title={<>Agents negotiate. <em>A person holds the pen.</em></>} />
        <div className="ag2-lanes" aria-hidden="true">
          <span><Glyph d={G.bot} />Client agent</span>
          <span><Glyph d={G.person} />Person</span>
          <span><Glyph d={G.bot} />Provider agent</span>
        </div>
        <ol className="ag2-calls" aria-label="An agent-to-agent contract, call by call">
          {CALLS.map((c, i) => (
            <li key={c.tool} className={`ph ag2-call ag2-${c.who}`} style={w(0.05 + i * 0.09, 0.14 + i * 0.09)}>
              <code>{c.tool}</code>
              {c.who === "h" && <span className="ag2-gate"><Glyph d={G.lock} className="ag2-lock" /><Glyph d={G.check} className="ag2-ok" />human gate</span>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Disputes: one tile freezes, the rest keep releasing; three clocks; a verdict paid in two legs ── */
export function DisputesScene() {
  const stateAt: Record<string, [number, number]> = { M02: [0.04, 0.12], M03: [0.08, 0.16], M04: [0.14, 0.24], M05: [0.24, 0.32], M06: [0.3, 0.38] };
  return (
    <section id="disputes" className="sc sc-dark sc-disputes" data-progress aria-labelledby="sc-disputes-h">
      <div className="lp-wrap">
        <Head id="sc-disputes-h" kicker="Disputes" title={<>One milestone freezes. <em>The rest keeps moving.</em></>} />
        <ol className="dp2-tiles" aria-label="Six milestones: M04 frozen in a dispute, the others released or still held">
          {EXAMPLE_SHARES.map((s) => {
            const at = stateAt[s.code];
            return (
              <li key={s.code} className={`ph dp2-tile dp2-${s.code === "M04" ? "frozen" : at ? "released" : "held"}`} style={at ? w(at[0], at[1]) : w(0, 0.01)}>
                <b>{s.code}</b>
                <span className="dp2-ico">{s.code === "M04" ? <Glyph d={G.snow} /> : at ? <Glyph d={G.check} /> : <Glyph d={G.lock} />}</span>
              </li>
            );
          })}
        </ol>
        <ol className="dp2-tiers" aria-label="Three tiers with fixed clocks">
          {[
            { t: "48 h", n: "Blind bids", d: G.env },
            { t: "96 h", n: "Sealed vault", d: G.lock },
            { t: "Mediator", n: "Signs the verdict", d: G.pen },
          ].map((x, i) => (
            <li key={x.n} className="ph dp2-tier" style={w(0.4 + i * 0.1, 0.52 + i * 0.1)}>
              <svg className="dp2-clock" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" className="dp2-ring-bg" /><circle cx="32" cy="32" r="28" pathLength={1} className="dp2-ring" /></svg>
              <span className="dp2-tier-ico"><Glyph d={x.d} /></span>
              <b>{x.t}</b><span>{x.n}</span>
            </li>
          ))}
        </ol>
        <div className="ph dp2-verdict" style={w(0.72, 0.86)} aria-label="The verdict executes as two legs, each with its own idempotency key">
          <div className="dp2-split"><span className="dp2-leg-c">refund → client</span><span className="dp2-leg-p">release → provider</span></div>
          <p><Glyph d={G.key} /> two legs · one key each</p>
        </div>
      </div>
    </section>
  );
}

/* ── How it works: a coin rides six stations ── */
const STATIONS = [["Blueprint", G.doc], ["Checkable", G.list], ["Held in PayPal", G.vault], ["Evidence", G.upload], ["Approve + MFA", G.shield], ["Partial capture", G.coin]] as const;
export function HowScene() {
  return (
    <section id="how" className="sc sc-how" data-progress aria-labelledby="sc-how-h">
      <div className="lp-wrap">
        <Head id="sc-how-h" kicker="How it works" title="Six steps. Blueprint to release." />
        <ol className="hw2-track" aria-label="Six steps from blueprint to release">
          <span className="hw2-rail" aria-hidden="true"><span className="hw2-fill" /><span className="hw2-coin"><Glyph d={G.coin} /></span></span>
          {STATIONS.map(([n, d], i) => (
            <li key={n} className="ph hw2-st" style={w(0.08 + i * 0.13, 0.14 + i * 0.13)}>
              <span className="hw2-dot"><Glyph d={d} /></span>
              <span className="hw2-n">{String(i + 1).padStart(2, "0")}</span>
              <b>{n}</b>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── What this is, and what it is not: four stamps, then the one thing it is ── */
const NOT = ["Live money", "A replacement for PayPal's protection", "An AI judge", "A marketplace"];
export function LimitsScene() {
  return (
    <section id="limits" className="sc sc-limits" data-progress aria-labelledby="sc-limits-h">
      <div className="lp-wrap">
        <Head id="sc-limits-h" kicker="Honest limits" title="What this is, and what it is not." />
        <ul className="lm2-not">
          {NOT.map((t, i) => (
            <li key={t} className="ph lm2-card" style={w(0.1 + i * 0.1, 0.18 + i * 0.1)}>
              <span className="lm2-t">{t}</span>
              <span className="lm2-stamp" aria-label="not">NOT</span>
            </li>
          ))}
        </ul>
        <p className="ph lm2-is" style={w(0.58, 0.72)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="lm2-tick"><path d={G.check} pathLength={1} /></svg>
          <span><b>It is</b> a way to agree what done means, and release money only when it is.</span>
        </p>
        <p className="lm2-note">Sandbox only: production needs PayPal approval and legal review.</p>
      </div>
    </section>
  );
}
