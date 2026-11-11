"use client";
/** A5 · Mint an agent token; the token is shown once in this form and never stored in readable form. */
import { useActionState } from "react";
import { mintToken, type MintState } from "./actions";

export function MintForm({ mcpUrl }: { mcpUrl: string }) {
  const [state, action, pending] = useActionState<MintState, FormData>(mintToken, {});
  return (
    <form action={action} className="stack">
      <div className="ai-form">
        <div className="field"><label htmlFor="ai-label">Label</label><input id="ai-label" name="label" type="text" maxLength={60} placeholder="Claude desktop agent" /></div>
        <div className="field"><label htmlFor="ai-limit">Spend limit (USD)</label><input id="ai-limit" name="limit" type="number" min={0} max={100000} step="0.01" defaultValue="15000" aria-describedby="ai-limit-help" /></div>
        <div className="field"><label htmlFor="ai-hours">Lifetime (hours)</label><input id="ai-hours" name="hours" type="number" min={1} max={720} defaultValue={24} /></div>
      </div>
      <p id="ai-limit-help" className="small muted">The agent can ask for funding up to this total. The buyer still approves every hold in PayPal, and releases always need the client&apos;s approval in this app.</p>
      <div className="row"><button className="btn btn-g btn-sm" type="submit" disabled={pending}>{pending ? "Creating…" : "Create agent token"}</button></div>
      {state.error ? <p className="notice" data-b="warn" role="alert">{state.error}</p> : null}
      {state.token ? (
        <div className="notice" role="status">
          <p><strong>Token for “{state.label}”</strong> (spend limit {state.limit}). Copy it now; it is shown once.</p>
          <code className="ai-token">{state.token}</code>
          <p className="small muted">MCP server: <code>{mcpUrl}</code> · header <code>Authorization: Bearer &lt;token&gt;</code></p>
        </div>
      ) : null}
    </form>
  );
}
