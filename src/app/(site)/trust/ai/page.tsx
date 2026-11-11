/**
 * A8 · A6 · /trust/ai — the AI scorecard: each AI feature with what it may and may not do (P3), its rule fallback, the
 * labelled test sets in evals/golden with rule results computed on this request, model results from evals/results.json
 * (pending until a run with an AI key writes them), what the AI reads, a model card and the governance note.
 */
import "@/styles/trust.css";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Cta, PageHero, SiteMain } from "@/components/site/parts";
import { JudgeTour } from "@/components/tour/JudgeTour";
import { configFromEnv } from "@/lib/ai/config";
import { NOT_SENT, SENT } from "@/lib/ai/notice";
import { AI_FEATURES, AI_SWITCH_WIRED } from "@/data/trust";
import { aiStatus } from "@/server/ai";
import { GOLDEN, modelResult, ruleScorecard, type ModelResult, type SetResult } from "./scorecard";

export const metadata = {
  title: "AI scorecard",
  description: "What each AI feature in PaySettle may and may not do, how it is tested, and the latest results.",
  alternates: { canonical: "/trust/ai" },
};
export const dynamic = "force-dynamic";

async function loadResults(): Promise<unknown> {
  try { return JSON.parse(await readFile(path.join(process.cwd(), "evals", "results.json"), "utf8")); } catch { return null; }
}
async function loadStatus(): Promise<{ available: boolean; reason?: string; model?: string } | null> {
  try { return await aiStatus(); } catch { return null; }
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
};

function Metrics({ r }: { r: SetResult }) {
  return (
    <>
      {r.metrics.map((m) => (
        <div key={m.label} className="tr-metric">
          <span>{m.label}: <b>{m.value} of {m.of}</b></span>
          {m.target !== "reported" && (
            <span className="tr-pass small">Target: {m.target} <span className="chip" data-b={m.pass ? "ok" : "danger"}>{m.pass ? "Meets target" : "Below target"}</span></span>
          )}
        </div>
      ))}
    </>
  );
}

function Model({ m }: { m: ModelResult }) {
  if (m.state === "pending") return <span className="chip" data-b="none">{m.reason}</span>;
  return (
    <div className="tr-metric">
      {m.lines.map((l) => <span key={l}>{l}</span>)}
      <span className="tr-pass small"><span className="chip" data-b={m.pass ? "ok" : "danger"}>{m.pass ? "Meets target" : "Below target"}</span> {m.model}, {fmtDate(m.at)}</span>
    </div>
  );
}

export default async function Page() {
  const [results, status] = await Promise.all([loadResults(), loadStatus()]);
  const rules = ruleScorecard();
  const cfg = configFromEnv();
  const bySet = new Map(rules.map((r) => [r.id, r]));
  const modelRan = rules.some((r) => modelResult(results, r.id).state === "ran");
  return (
    <SiteMain>
      <PageHero
        kicker="Trust · AI"
        title="AI scorecard"
        lead="What each AI feature in PaySettle may do, what it may not do, how it is tested, and the latest results. In PaySettle AI only advises: people sign, approve and release, and a mediator signs every verdict."
      >
        <p className="notice tr-ai-state" data-b={status?.available ? "ok" : "warn"} role="note">
          {status === null
            ? "AI status could not be read right now. Every feature has a rule-based fallback, so the product keeps working either way."
            : status.available
              ? `Model calls are on in this build (model ${status.model ?? cfg.model}). Each feature still falls back to its rules if the model is unavailable or answers badly.`
              : `Model calls are off in this build: ${status.reason ?? "no AI key is set."} Every feature below is running on its rules.`}
        </p>
        <p className="s-chips tr-hero-links">
          <Link className="btn" href="/trust">Trust by design</Link>
          <a className="btn" href="#evals">Test results</a>
          <a className="btn" href="#governance">Governance note</a>
        </p>
      </PageHero>

      <section id="features" className="s-section tight tr" aria-labelledby="features-h">
        <div className="s-wrap">
          <div className="s-head"><h2 id="features-h">Five AI features, and their limits</h2><p className="s-lead">Each one has a rule-based fallback that runs when AI is off, unavailable or gives an answer that does not match the expected format twice.</p></div>
          <ul className="tr-features">
            {AI_FEATURES.map((f) => (
              <li key={f.id} className="s-card">
                <article aria-labelledby={`f-${f.id}-h`}>
                  <h3 id={`f-${f.id}-h`}>{f.name}</h3>
                  <p className="tr-sub">{f.does}</p>
                  <div className="tr-mm">
                    <div><h4>It may</h4><ul>{f.may.map((x) => <li key={x}>{x}</li>)}</ul></div>
                    <div><h4>It may not</h4><ul>{f.mayNot.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  </div>
                  <p className="tr-fallback"><b>With AI off:</b> {f.fallback}</p>
                  <p className="small muted">{f.evalSet ? <>Test set: <a href={`#set-${f.evalSet}`}>{bySet.get(f.evalSet)?.title}</a>, {bySet.get(f.evalSet)?.cases} labelled cases.</> : f.evalNote}</p>
                </article>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="evals" className="s-section alt tr" aria-labelledby="evals-h">
        <div className="s-wrap">
          <div className="s-head">
            <h2 id="evals-h">Test sets and results</h2>
            <p className="s-lead">Four labelled sets live in the repository under <code>evals/golden</code>. The rule results below are computed from those files each time this page loads. Model results come from the last run of <code>npm run eval</code> with an AI key; nothing is estimated.</p>
          </div>
          <div className="tr-table-wrap">
            <table className="tr-table">
              <caption className="sr-only">AI test sets with rule results and model results</caption>
              <thead><tr><th scope="col">Test set</th><th scope="col">Cases</th><th scope="col">Rule fallback, now</th><th scope="col">AI model</th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} id={`set-${r.id}`}>
                    <th scope="row">{r.title}<div className="small muted">{r.feature}</div></th>
                    <td className="tnum">{r.cases}</td>
                    <td><Metrics r={r} /><p className="small muted">{r.note}</p></td>
                    <td><Model m={modelResult(results, r.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="s-note">
            {modelRan ? "Model results are shown for the sets the last run covered." : "No model run has been recorded yet, so every model result is pending."} The compile set has {GOLDEN.compile.items.length} criteria, the evidence set {GOLDEN.evidence.cases.length} packages ({GOLDEN.evidence.cases.filter((c) => c.spoofed).length} spoofed), the mediation set {GOLDEN.mediate.cases.length} disputes and the injection set {GOLDEN.injection.cases.length} attacks.
          </p>
        </div>
      </section>

      <section id="data" className="s-section tr" aria-labelledby="data-h">
        <div className="s-wrap">
          <div className="s-head"><h2 id="data-h">What the AI reads, and what it never gets</h2><p className="s-lead">PaySettle does not train or fine-tune any model, on legal texts or on your contracts. The AI reads only the case in front of it. The root-cause tags mediators add to verdicts build our own outcome data instead.</p></div>
          <div className="tr-two">
            <div className="s-card"><h3>Sent to the AI provider</h3><ul>{SENT.map((x) => <li key={x}>{x}</li>)}</ul></div>
            <div className="s-card"><h3>Never sent</h3><ul>{NOT_SENT.map((x) => <li key={x}>{x}</li>)}</ul></div>
          </div>
        </div>
      </section>

      <section id="governance" className="s-section alt tr" aria-labelledby="governance-h">
        <div className="s-wrap">
          <div className="s-head"><h2 id="governance-h">Model card and governance note</h2></div>
          <div className="tr-gov">
            <div className="s-card">
              <h3>Model card</h3>
              <dl>
                <dt>Model</dt><dd>{cfg.model}, set by configuration; the gateway can switch providers without code changes</dd>
                <dt>Interface</dt><dd>{cfg.protocol === "openai" ? "OpenAI-compatible chat completions" : "Anthropic Messages API"}</dd>
                <dt>Settings</dt><dd>Temperature 0; one JSON answer checked against a schema; one retry, then the rules</dd>
                <dt>Spend</dt><dd>At most {cfg.dailyTokenCap.toLocaleString("en-US")} tokens a day (resets 00:00 UTC); {Math.round(cfg.timeoutMs / 1000)} s timeout per call</dd>
                <dt>Training</dt><dd>None. No PaySettle data is used to train or tune a model</dd>
                <dt>Party text</dt><dd>Wrapped as untrusted data, with an instruction never to follow instructions inside it</dd>
              </dl>
            </div>
            <div className="s-card">
              <h3>Who decides, and who can turn AI off</h3>
              <p><b>AI cannot move money.</b> AI code never writes contracts, ledger entries, signatures or releases. Every release needs a client&apos;s signed approval or a mediator&apos;s signed verdict.</p>
              <p><b>Appeals go to people.</b> A party who disagrees opens a dispute. Mediators see the AI proposal as advice and sign the verdict themselves.</p>
              <p><b>Every call is logged</b> with its purpose, model, token count, cost and a fingerprint of the input. Names and e-mail addresses are masked before anything is sent.</p>
              <p><b>Test gates.</b> The rule test set for the Criteria Compiler runs with the unit tests on every push. The model sets run with one command when a key is set; making them a required release check is still to do.</p>
              <p>
                <b>Turning AI off.</b>{" "}
                {AI_SWITCH_WIRED
                  ? "An admin can switch AI assistance off on the switchboard; the change needs a second person's approval (four-eyes) and is recorded in the audit chain. Every feature then runs on its rules."
                  : "Today the operator turns AI off by removing the AI key from the server settings; every feature then runs on its rules from the next call. The switchboard's “AI assistance” switch, which needs a second admin's approval, is being connected to the AI gateway."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <Cta />
      {/* carries a running judge tour (A10) on this page; draws nothing otherwise */}
      <JudgeTour launcher={false} />
    </SiteMain>
  );
}
