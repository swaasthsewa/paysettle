/**
 * TEST FIXTURE ONLY (A6/A7 tests): a scripted fake LLM injected as the gateway's fetch, port of the reference
 * fake_llm helper. It answers Anthropic Messages (/v1/messages) or OpenAI-compatible (/chat/completions) envelopes,
 * records every request, and can fail with an HTTP status or hang until the gateway's timeout aborts it.
 * Product code never imports this file.
 */
export type Scripted = { text: string; usage?: [number, number] } | number | "hang" | ((body: Record<string, unknown>) => { text: string; usage?: [number, number] } | number);
export interface Recorded { url: string; headers: Record<string, string>; body: Record<string, unknown> }

export function fakeLlm() {
  const script: Scripted[] = [];
  const requests: Recorded[] = [];
  let fallback: Scripted | null = null;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url, headers: { ...(init?.headers as Record<string, string>) }, body });
    let item = script.length ? script.shift()! : fallback;
    if (item === null) return new Response(JSON.stringify({ error: { message: "no scripted response left" } }), { status: 500 });
    if (typeof item === "function") item = item(body);
    if (item === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
      });
    }
    if (typeof item === "number") return new Response(JSON.stringify({ error: { message: `scripted failure ${item}` } }), { status: item });
    const [inT, outT] = item.usage ?? [120, 40];
    const envelope = url.endsWith("/chat/completions")
      ? { id: "cmpl-fake", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: item.text }, finish_reason: "stop" }], usage: { prompt_tokens: inT, completion_tokens: outT } }
      : { id: "msg-fake", type: "message", role: "assistant", content: [{ type: "text", text: item.text }], stop_reason: "end_turn", usage: { input_tokens: inT, output_tokens: outT } };
    return new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    requests,
    reply(value: unknown, usage?: [number, number]) { script.push({ text: typeof value === "string" ? value : JSON.stringify(value), usage }); return this; },
    respond(fn: (body: Record<string, unknown>) => { text: string; usage?: [number, number] } | number) { script.push(fn); return this; },
    fail(status: number, times = 1) { for (let i = 0; i < times; i++) script.push(status); return this; },
    hang() { script.push("hang"); return this; },
    always(value: unknown) { fallback = { text: typeof value === "string" ? value : JSON.stringify(value) }; return this; },
    /** All text the model was sent in request n (system + every message block), for assertions. */
    sentText(n = 0): string {
      const b = requests[n]?.body ?? {};
      const parts: string[] = [];
      if (typeof b.system === "string") parts.push(b.system);
      for (const m of (b.messages as { content: unknown }[] | undefined) ?? []) {
        if (typeof m.content === "string") parts.push(m.content);
        else for (const c of (m.content as { text?: string }[]) ?? []) if (c.text) parts.push(c.text);
      }
      return parts.join("\n");
    },
  };
}
