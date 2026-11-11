/* P8 — the apiSnippet block: a read-only request/response sample. Shown as text in <pre>, never executed;
 * the service refuses samples that look like keys or tokens. Server-safe. */
export function ApiSnippet({ method, path, request, response, note }: { method: "GET" | "POST" | "PATCH"; path: string; request?: string; response?: string; note?: string }) {
  return (
    <figure className="bl-api">
      <div className="bl-api-head"><span className="bl-api-m" data-m={method}>{method}</span><code>{path}</code></div>
      {request && (<><p className="bl-api-k">Request</p><div className="bl-scroll" role="region" aria-label={`${method} ${path} request`} tabIndex={0}><pre><code>{request}</code></pre></div></>)}
      {response && (<><p className="bl-api-k">Response</p><div className="bl-scroll" role="region" aria-label={`${method} ${path} response`} tabIndex={0}><pre><code>{response}</code></pre></div></>)}
      {note && <figcaption className="bl-cap">{note}</figcaption>}
    </figure>
  );
}
export default ApiSnippet;
