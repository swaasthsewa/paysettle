/**
 * A7 · One gateway for every AI call.
 *
 * - Provider-agnostic: Anthropic Messages API by default (POST {base}/v1/messages, x-api-key, anthropic-version
 *   2023-06-01); AI_PROTOCOL=openai switches to an OpenAI-compatible POST {base}/chat/completions. Configuration only.
 * - Daily token cap per UTC day, counted from ai_calls (store.tokensSince). A request that would pass the cap is refused.
 * - Timeout 30 s per HTTP call (AbortController).
 * - Structured output: the model must answer with one JSON object; it is validated with zod. Invalid JSON or a schema
 *   mismatch → exactly one retry with the error shown to the model → then { ok: false, code: "invalid_output" }.
 *   Never a guess: callers show "AI unavailable" plus rule-based output.
 * - Every HTTP call is logged (purpose, model, tokens, cost estimate, input hash, output, ok, latency).
 * - Redaction (redact.ts) runs on every text part; untrusted parts are wrapped (untrusted.ts) and the system prompt
 *   always carries UNTRUSTED_RULE.
 * - No key → { ok: false, code: "not_configured" } without any network call.
 * Dependencies (fetch, store, clock) are injected so tests run against a fake LLM without a network or database.
 */
import { z } from "zod";
import { sha256 } from "@/lib/ids";
import { costMicros, endpointFor, utcDayStart, type AiConfig } from "./config";
import { EMPTY_PEOPLE, redactText, type People } from "./redact";
import { UNTRUSTED_RULE, neutralise, untrusted } from "./untrusted";


/** A reason without its closing period, for sentences that append their own punctuation ("… — <reason>. Next sentence."). */
export const reasonClause = (reason?: string | null): string => (reason ?? "").trim().replace(/[.\s]+$/, "");

export type Part =
  | { kind: "text"; text: string }
  | { kind: "untrusted"; source: string; text: string }
  | { kind: "image"; source: string; mediaType: string; base64: string };

export interface CallLog { purpose: string; model: string; tokensIn: number; tokensOut: number; costMicros: number; inputHash: string; output: unknown; ok: boolean; latencyMs: number }
export interface AiStore { tokensSince(since: Date): Promise<number>; log(c: CallLog): Promise<void>; people(): Promise<People> }

export type FailCode = "not_configured" | "cap_reached" | "timeout" | "http_error" | "unreachable" | "bad_response" | "invalid_output";
export type Outcome<T> =
  | { ok: true; data: T; model: string; tokensIn: number; tokensOut: number; attempts: number }
  | { ok: false; code: FailCode; reason: string; model?: string; attempts: number };

export interface StructuredRequest<T> { purpose: string; system: string; parts: Part[]; schema: z.ZodType<T>; maxTokens?: number }
export interface GatewayDeps { fetch?: typeof fetch; store: AiStore; now?: () => Date; enabled?: () => Promise<boolean> }

type Msg = { role: "user" | "assistant"; content: unknown };
const IMAGE_TOKENS = 1_600;
const MAX_OUTPUT_LOG_CHARS = 4_000;

/** The first JSON object in a model answer (code fences and prose around it are tolerated). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new SyntaxError("no JSON object in the answer");
}

const issues = (e: z.ZodError) => e.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

export class AiGateway {
  private readonly f: typeof fetch;
  private readonly now: () => Date;
  constructor(readonly config: AiConfig, private readonly deps: GatewayDeps) {
    this.f = deps.fetch ?? fetch;
    this.now = deps.now ?? (() => new Date());
  }

  async usedToday(): Promise<number> { return this.deps.store.tokensSince(utcDayStart(this.now())); }

  async status(): Promise<{ available: boolean; reason?: string; model: string; usedTokensToday: number; capTokens: number; protocol: string }> {
    const used = await this.usedToday().catch(() => 0);
    const base = { model: this.config.model, usedTokensToday: used, capTokens: this.config.dailyTokenCap, protocol: this.config.protocol };
    if (this.deps.enabled && !(await this.deps.enabled().catch(() => true))) return { ...base, available: false, reason: "AI assistance is switched off on the switchboard. Rule-based checks still run." };
    if (!this.config.apiKey) return { ...base, available: false, reason: "No AI key is configured (AI_API_KEY is not set). Rule-based checks still run." };
    if (used >= this.config.dailyTokenCap) return { ...base, available: false, reason: `Today's AI token cap (${this.config.dailyTokenCap.toLocaleString("en-US")}) is used up; it resets at 00:00 UTC.` };
    return { ...base, available: true };
  }

  /** Build the redacted, wrapped content blocks for the configured protocol. */
  private content(parts: Part[], people: People): { anthropic: unknown[]; openai: unknown[]; chars: number; images: number } {
    const anthropic: unknown[] = [], openai: unknown[] = [];
    let chars = 0, images = 0;
    for (const p of parts) {
      if (p.kind === "image") {
        images++;
        const label = neutralise(redactText(p.source, people)).slice(0, 120);
        anthropic.push({ type: "text", text: `Image (untrusted upload) "${label}":` });
        anthropic.push({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } });
        openai.push({ type: "text", text: `Image (untrusted upload) "${label}":` });
        openai.push({ type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.base64}` } });
        continue;
      }
      const text = p.kind === "untrusted" ? untrusted(redactText(p.source, people), redactText(p.text, people)) : redactText(p.text, people);
      chars += text.length;
      anthropic.push({ type: "text", text });
      openai.push({ type: "text", text });
    }
    return { anthropic, openai, chars, images };
  }

  private body(system: string, messages: Msg[], maxTokens: number): unknown {
    const c = this.config;
    if (c.protocol === "openai") {
      return {
        model: c.model, temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
      };
    }
    // No temperature: current Claude models reject the parameter (HTTP 400 "temperature is deprecated").
    return { model: c.model, max_tokens: maxTokens, system, messages };
  }

  private headers(): Record<string, string> {
    const c = this.config;
    if (c.protocol === "openai") return { "content-type": "application/json", authorization: `Bearer ${c.apiKey}` };
    return { "content-type": "application/json", "x-api-key": c.apiKey ?? "", "anthropic-version": "2023-06-01" };
  }

  private parseEnvelope(raw: unknown): { text: string; tokensIn: number; tokensOut: number } {
    const r = (raw ?? {}) as { choices?: { message?: { content?: unknown } }[]; content?: unknown; usage?: Record<string, unknown> };
    const blocksText = (v: unknown) => (Array.isArray(v) ? v : [])
      .filter((b): b is { type?: string; text?: unknown } => !!b && typeof b === "object")
      .filter((b) => b.type === undefined || b.type === "text").map((b) => String(b.text ?? "")).join("");
    if (this.config.protocol === "openai") {
      const msg = r.choices?.[0]?.message;
      if (!msg) throw new Error("not a chat completion");
      const text = typeof msg.content === "string" ? msg.content : blocksText(msg.content);
      return { text, tokensIn: Number(r.usage?.prompt_tokens ?? 0), tokensOut: Number(r.usage?.completion_tokens ?? 0) };
    }
    if (!Array.isArray(r.content)) throw new Error("not a Messages API response");
    return { text: blocksText(r.content), tokensIn: Number(r.usage?.input_tokens ?? 0), tokensOut: Number(r.usage?.output_tokens ?? 0) };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<Outcome<T>> {
    const c = this.config;
    if (this.deps.enabled && !(await this.deps.enabled().catch(() => true))) return { ok: false, code: "not_configured", reason: "AI assistance is switched off on the switchboard.", attempts: 0 };
    if (!c.apiKey) return { ok: false, code: "not_configured", reason: "No AI key is configured (AI_API_KEY is not set).", attempts: 0 };
    const people = await this.deps.store.people().catch(() => EMPTY_PEOPLE);
    const built = this.content(req.parts, people);
    const maxTokens = req.maxTokens ?? c.maxTokens;
    const schemaJson = JSON.stringify(z.toJSONSchema(req.schema as z.ZodType));
    const system = [
      req.system.trim(),
      UNTRUSTED_RULE,
      "Answer with exactly one JSON object and nothing else (no prose, no code fences). It must validate against this JSON Schema:",
      schemaJson,
      "If you cannot judge something from the material given, say so in the JSON (for example verdict \"unclear\"); never invent facts.",
    ].join("\n\n");
    const firstContent = c.protocol === "openai" ? built.openai : built.anthropic;
    const messages: Msg[] = [{ role: "user", content: firstContent }];
    const estimate = Math.ceil((system.length + built.chars) / 4) + built.images * IMAGE_TOKENS;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const used = await this.usedToday();
      if (used >= c.dailyTokenCap || used + estimate * attempt + maxTokens > c.dailyTokenCap) {
        return { ok: false, code: "cap_reached", reason: `Today's AI token cap (${c.dailyTokenCap.toLocaleString("en-US")}) would be passed; AI resumes at 00:00 UTC.`, model: c.model, attempts: attempt - 1 };
      }
      const body = this.body(system, messages, maxTokens);
      const inputHash = sha256(JSON.stringify(body));
      const started = Date.now();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), c.timeoutMs);
      let res: Response;
      try {
        res = await this.f(endpointFor(c), { method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: ctl.signal });
      } catch (e) {
        clearTimeout(timer);
        const timeout = ctl.signal.aborted || (e as Error)?.name === "AbortError";
        await this.log(req.purpose, inputHash, 0, 0, { error: timeout ? "timeout" : "unreachable" }, false, started);
        return timeout
          ? { ok: false, code: "timeout", reason: `The AI provider did not answer within ${Math.round(c.timeoutMs / 1000)} s.`, model: c.model, attempts: attempt }
          : { ok: false, code: "unreachable", reason: "The AI provider cannot be reached.", model: c.model, attempts: attempt };
      }
      clearTimeout(timer);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        await this.log(req.purpose, inputHash, 0, 0, { error: `http_${res.status}`, detail: detail.slice(0, 300) }, false, started);
        return { ok: false, code: "http_error", reason: `The AI provider refused or failed the request (HTTP ${res.status}).`, model: c.model, attempts: attempt };
      }
      let env: { text: string; tokensIn: number; tokensOut: number };
      try { env = this.parseEnvelope(await res.json()); } catch {
        await this.log(req.purpose, inputHash, 0, 0, { error: "bad_response" }, false, started);
        return { ok: false, code: "bad_response", reason: "The AI provider sent a response in an unexpected format.", model: c.model, attempts: attempt };
      }
      const tokensIn = env.tokensIn || estimate, tokensOut = env.tokensOut || Math.ceil(env.text.length / 4);
      let problem: string;
      try {
        const parsed = req.schema.safeParse(extractJson(env.text));
        if (parsed.success) {
          await this.log(req.purpose, inputHash, tokensIn, tokensOut, parsed.data, true, started);
          return { ok: true, data: parsed.data, model: c.model, tokensIn, tokensOut, attempts: attempt };
        }
        problem = `The JSON does not match the schema: ${issues(parsed.error)}`;
      } catch (e) {
        problem = `The answer is not valid JSON (${(e as Error).message}).`;
      }
      await this.log(req.purpose, inputHash, tokensIn, tokensOut, { error: "invalid_output", problem, raw: env.text.slice(0, MAX_OUTPUT_LOG_CHARS) }, false, started);
      messages.push({ role: "assistant", content: c.protocol === "openai" ? env.text || "(empty)" : [{ type: "text", text: env.text || "(empty)" }] });
      const fix = `${problem} Reply again with only the corrected JSON object.`;
      messages.push({ role: "user", content: c.protocol === "openai" ? fix : [{ type: "text", text: fix }] });
    }
    return { ok: false, code: "invalid_output", reason: "The AI answer did not match the expected format twice, so no AI answer is shown.", model: c.model, attempts: 2 };
  }

  private async log(purpose: string, inputHash: string, tokensIn: number, tokensOut: number, output: unknown, ok: boolean, started: number) {
    try {
      await this.deps.store.log({ purpose, model: this.config.model, tokensIn, tokensOut, costMicros: costMicros(this.config, tokensIn, tokensOut), inputHash, output, ok, latencyMs: Date.now() - started });
    } catch { /* logging must never break the call path */ }
  }
}

/** In-memory store for tests and the evaluation runner without a database. */
export function memoryStore(people: People = EMPTY_PEOPLE): AiStore & { calls: (CallLog & { at: Date })[] } {
  const calls: (CallLog & { at: Date })[] = [];
  return {
    calls,
    async tokensSince(since) { return calls.filter((x) => x.at >= since).reduce((s, x) => s + x.tokensIn + x.tokensOut, 0); },
    async log(cl) { calls.push({ ...cl, at: new Date() }); },
    async people() { return people; },
  };
}
