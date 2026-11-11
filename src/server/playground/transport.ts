/**
 * How the playground reaches HTTP endpoints of other modules (PayPal webhook receiver, MCP server): F5.06, F5.08.
 * In-process first — the route handler module is called with a real Request, so it works in tests and inside the app without
 * a network hop — and over HTTP to the app's own origin when no in-process handler is registered.
 */
import { WaitingFor } from "./session";

type Handler = (req: Request) => Promise<Response> | Response;
type RouteModule = { GET?: Handler; POST?: Handler };

/** Route modules the playground drives, by path. Filled with the routes that exist in the repository. */
const IN_PROCESS: Record<string, () => Promise<RouteModule>> = {
  "/api/webhooks/paypal": async () => (await import("@/app/api/webhooks/paypal/route")) as unknown as RouteModule,
  "/api/mcp": async () => (await import("@/app/api/mcp/route")) as unknown as RouteModule,
};

export function registerRoute(path: string, load: () => Promise<RouteModule>) { IN_PROCESS[path] = load; }

export interface HttpResult { status: number; headers: Headers; text: string; json: unknown; via: "in-process" | "http" }

export async function httpCall(path: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string }, baseUrl?: string, module = "other"): Promise<HttpResult> {
  const loader = IN_PROCESS[path];
  let res: Response, via: HttpResult["via"];
  if (loader) {
    const mod = await loader();
    const h = mod[init.method];
    if (!h) throw new WaitingFor(module, `${init.method} ${path} has no handler yet`);
    res = await h(new Request(`${baseUrl ?? process.env.APP_URL ?? "http://localhost:3000"}${path}`, { method: init.method, headers: init.headers, body: init.body }));
    via = "in-process";
  } else {
    if (!baseUrl) throw new WaitingFor(module, `${path} is not available in-process and no app address is known`);
    try { res = await fetch(baseUrl + path, { method: init.method, headers: init.headers, body: init.body }); }
    catch (e) { throw new WaitingFor(module, `${path} did not answer (${String(e).slice(0, 80)})`); }
    if (res.status === 404) throw new WaitingFor(module, `${path} answers 404 — not built yet`);
    via = "http";
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = parseSse(text); }
  return { status: res.status, headers: res.headers, text, json, via };
}

/** Streamable-HTTP MCP servers may answer with a text/event-stream; take the last JSON `data:` line. */
function parseSse(text: string): unknown {
  const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  for (let i = data.length - 1; i >= 0; i--) { try { return JSON.parse(data[i]); } catch { /* next */ } }
  return null;
}
