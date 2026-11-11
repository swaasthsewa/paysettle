/**
 * A5 · A6 · A7 · Account → AI & agents: AI availability and today's token use against the cap, what is sent to the
 * provider, MCP agent tokens (mint, revoke, spend), the agent's pending release requests, and the latest evaluation run.
 * Real data: ai_calls, agent_tokens, agent_approvals, evals/results.json.
 */
import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import "@/styles/ai.css";
import { requireViewer } from "@/lib/session";
import { sandboxMode } from "@/lib/clock";
import { formatCents } from "@/lib/money";
import { utcDayStart } from "@/lib/ai/config";
import { ADVISORY, NOT_SENT, SENT } from "@/lib/ai/notice";
import { aiStatus } from "@/server/ai";
import { listAgentApprovalsForUser, listAgentTokens } from "@/server/ai/agent";
import { recentCalls, usageSince } from "@/server/ai/store";
import { MintForm } from "./mint-form";
import { dismissRequest, revokeToken } from "./actions";

export const metadata = { title: "AI & agents" };
export const dynamic = "force-dynamic";

const when = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`;

type EvalResults = { at?: string; model?: string | null; compile?: { rules?: { recallVague: number; precisionVague: number; agreement: number; pass: boolean }; ai?: { recallVague: number; pass: boolean } }; evidence?: { skipped?: boolean; agreement?: number; spoofedApproved?: number; pass?: boolean }; mediate?: { skipped?: boolean; within10Points?: number; pass?: boolean }; injection?: { skipped?: boolean; instructionsFollowed?: number; pass?: boolean } };
async function lastEval(): Promise<EvalResults | null> {
  try { return JSON.parse(await readFile(path.join(process.cwd(), "evals", "results.json"), "utf8")) as EvalResults; } catch { return null; }
}

export default async function AiPage() {
  const v = await requireViewer();
  const now = new Date();
  const [status, today, tokens, requests, evals] = await Promise.all([aiStatus(), usageSince(utcDayStart(now)), listAgentTokens(v.id), listAgentApprovalsForUser(v.id), lastEval()]);
  const seesCalls = v.role === "admin" || v.role === "finance" || v.role === "judge";
  const calls = seesCalls ? await recentCalls(15) : [];
  const pct = status.capTokens ? Math.min(100, Math.round((status.usedTokensToday / status.capTokens) * 100)) : 0;
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const active = tokens.filter((t) => !t.revokedAt && t.expiresAt > now);
  const pending = requests.filter((r) => r.state === "PENDING");

  return (
    <>
      <div className="phead">
        <div>
          <h1>AI &amp; agents</h1>
          <p className="sub">AI drafts, lints, checks evidence and proposes dispute splits. {ADVISORY}</p>
        </div>
      </div>

      <div className="grid-cards">
        <section className="c" aria-labelledby="ai-status">
          <div className="row"><h2 id="ai-status">AI status</h2><span className="sp" /><span className="chip" data-b={status.available ? "ok" : "warn"}>{status.available ? "Available" : "Unavailable"}</span></div>
          {!status.available && status.reason ? <p className="notice" data-b="warn">{status.reason}</p> : null}
          <dl className="kv">
            <div><dt>Model</dt><dd>{status.model ?? "—"}</dd></div>
            <div><dt>Tokens today (UTC)</dt><dd className="tnum">{status.usedTokensToday.toLocaleString("en-US")} of {status.capTokens.toLocaleString("en-US")}<small>Resets at 00:00 UTC; calls stop at the cap and rule-based checks continue.</small></dd></div>
            <div><dt>Calls today</dt><dd className="tnum">{today.calls} ({today.ok} valid)<small>Estimated cost {usd(today.costMicros)}</small></dd></div>
          </dl>
          <div className="ai-meter" role="meter" aria-label="Share of today's token cap used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
        </section>

        <section className="c" aria-labelledby="ai-sent">
          <h2 id="ai-sent">What is sent to the AI provider</h2>
          <ul className="ai-list">{SENT.map((s) => <li key={s}>{s}</li>)}</ul>
          <h3 className="small">Never sent</h3>
          <ul className="ai-list">{NOT_SENT.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>

        <section className="c" aria-labelledby="ai-evals">
          <h2 id="ai-evals">Latest evaluation</h2>
          {evals ? (
            <dl className="kv">
              <div><dt>Criteria linter (rules)</dt><dd>{evals.compile?.rules ? `recall ${evals.compile.rules.recallVague} · precision ${evals.compile.rules.precisionVague}` : "not run"}<small>Target: recall on vague criteria ≥ 0.90</small></dd></div>
              <div><dt>Criteria linter (AI)</dt><dd>{evals.compile?.ai ? `recall ${evals.compile.ai.recallVague}` : "not run (no AI key)"}</dd></div>
              <div><dt>Evidence check</dt><dd>{evals.evidence?.skipped ? "skipped (no AI key)" : evals.evidence ? `agreement ${evals.evidence.agreement} · spoofed approved ${evals.evidence.spoofedApproved}` : "not run"}<small>Target: ≥ 0.85, no approval on a spoofed case</small></dd></div>
              <div><dt>Dispute proposals</dt><dd>{evals.mediate?.skipped ? "skipped (no AI key)" : evals.mediate ? `within 10 points ${evals.mediate.within10Points}` : "not run"}<small>Target: ≥ 0.80</small></dd></div>
              <div><dt>Prompt injection</dt><dd>{evals.injection?.skipped ? "skipped (no AI key)" : evals.injection ? `instructions followed ${evals.injection.instructionsFollowed}` : "not run"}<small>Target: 0</small></dd></div>
              <div><dt>Run</dt><dd>{evals.at ? evals.at.slice(0, 16).replace("T", " ") + " UTC" : "—"}<small>{evals.model ?? "rules only"} · npx tsx evals/run.ts</small></dd></div>
            </dl>
          ) : <p className="muted small">No run recorded yet. Run <code>npx tsx evals/run.ts</code>.</p>}
        </section>
      </div>

      <section className="c" aria-labelledby="ai-agents">
        <h2 id="ai-agents">Agent tokens (MCP)</h2>
        <p className="small muted">An agent connected to <code>{base}/api/mcp</code> acts for you, with your role&apos;s permissions. It can draft and negotiate, read status, request funding and ask for a release. It cannot sign, approve or move money.</p>
        {sandboxMode() ? <MintForm mcpUrl={`${base}/api/mcp`} /> : <p className="notice">Agent tokens are a sandbox feature in this build.</p>}
        {tokens.length ? (
          <div className="ai-scroll">
            <table className="ptable">
              <caption className="sr-only">Your agent tokens</caption>
              <thead><tr><th scope="col">Label</th><th scope="col">Token</th><th scope="col">Spend used</th><th scope="col">Expires</th><th scope="col">Last used</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {tokens.map((t) => {
                  const live = !t.revokedAt && t.expiresAt > now;
                  return (
                    <tr key={t.id}>
                      <td>{t.label}</td>
                      <td><code>{t.prefix}…</code></td>
                      <td className="money">{formatCents(t.spentCents)} of {formatCents(t.spendLimitCents)}</td>
                      <td>{when(t.expiresAt)}</td>
                      <td>{when(t.lastUsedAt)}</td>
                      <td><span className="chip" data-b={live ? "ok" : "none"}>{t.revokedAt ? "Revoked" : live ? "Active" : "Expired"}</span></td>
                      <td>{live ? <form action={revokeToken}><input type="hidden" name="id" value={t.id} /><button className="btn btn-sm" type="submit" aria-label={`Revoke ${t.label}`}>Revoke</button></form> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted small">No agent tokens yet.</p>}
        <p className="small muted">{active.length} active. Demo script: <code>node evals/mcp-demo.mjs</code> with <code>PAYSETTLE_AGENT_TOKEN</code> set.</p>
      </section>

      <section className="c" aria-labelledby="ai-requests">
        <h2 id="ai-requests">Release requests from your agents</h2>
        {requests.length ? (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {requests.map((r) => {
              const amount = typeof r.detail?.amountCents === "number" ? formatCents(r.detail.amountCents as number) : null;
              return (
                <li key={r.id} className="row">
                  <span className="chip" data-b={r.state === "PENDING" ? "warn" : r.state === "CONFIRMED" ? "ok" : "none"}>{r.state === "PENDING" ? "Waiting for you" : r.state === "CONFIRMED" ? "Confirmed" : "Dismissed"}</span>
                  <span>Milestone <code>{r.milestoneId}</code>{amount ? ` · ${amount} still held in PayPal until you approve` : ""}{r.note ? ` · “${r.note}”` : ""}</span>
                  <span className="sp" />
                  <span className="small muted">{when(r.createdAt)}</span>
                  {r.state === "PENDING" ? (
                    <>
                      <Link className="btn btn-g btn-sm" href={`/contracts/${r.workspaceId}/m/${r.milestoneId}`}>Review and approve</Link>
                      <form action={dismissRequest}><input type="hidden" name="id" value={r.id} /><button className="btn btn-sm" type="submit">Dismiss</button></form>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : <p className="muted small">No requests. When an agent calls approve_release, it appears here and on the milestone; nothing is released until you approve it there.</p>}
        {pending.length ? <p className="small muted">{pending.length} waiting.</p> : null}
      </section>

      {seesCalls ? (
        <section className="c" aria-labelledby="ai-calls">
          <h2 id="ai-calls">Recent AI calls</h2>
          {calls.length ? (
            <div className="ai-scroll">
              <table className="ptable">
                <caption className="sr-only">Last 15 AI calls across the platform</caption>
                <thead><tr><th scope="col">When</th><th scope="col">Purpose</th><th scope="col">Model</th><th scope="col">Tokens in / out</th><th scope="col">Cost</th><th scope="col">Latency</th><th scope="col">Valid</th></tr></thead>
                <tbody>
                  {calls.map((c) => (
                    <tr key={c.id}><td>{when(c.createdAt)}</td><td><code>{c.purpose}</code></td><td>{c.model}</td><td className="tnum">{c.tokensIn} / {c.tokensOut}</td><td className="tnum">{usd(c.costMicros)}</td><td className="tnum">{c.latencyMs} ms</td><td><span className="chip" data-b={c.ok ? "ok" : "warn"}>{c.ok ? "Yes" : "No"}</span></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted small">No AI calls recorded yet{status.available ? "" : " (AI is unavailable, so only rule-based checks have run)"}.</p>}
        </section>
      ) : null}
    </>
  );
}
