/**
 * A7 · AI gateway configuration from the environment (P8: secrets only from env). Port of the reference gateway's
 * config_from(): the provider is configuration, not code. Defaults talk to the Anthropic Messages API.
 *
 * AI_PROTOCOL        anthropic (default) → POST {AI_BASE_URL}/v1/messages · openai → POST {AI_BASE_URL}/chat/completions
 * AI_BASE_URL        default https://api.anthropic.com
 * AI_API_KEY         no key → every AI surface reports { available: false } and rule-based output still runs
 * AI_MODEL           default claude-sonnet-5-5
 * AI_DAILY_TOKEN_CAP tokens (in + out) per UTC day, counted from ai_calls; default 200,000
 * AI_TIMEOUT_MS      default 30,000
 * AI_PRICE_IN_PER_MTOK / AI_PRICE_OUT_PER_MTOK  USD per million tokens for the cost estimate; default 3 / 15
 */
export type AiProtocol = "anthropic" | "openai";
export interface AiConfig {
  protocol: AiProtocol; baseUrl: string; apiKey: string | null; model: string;
  dailyTokenCap: number; timeoutMs: number; priceInPerMTok: number; priceOutPerMTok: number; maxTokens: number;
}
const num = (v: string | undefined, d: number) => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d; };

export function configFromEnv(env: Record<string, string | undefined> = process.env): AiConfig {
  const protocol: AiProtocol = (env.AI_PROTOCOL ?? "").toLowerCase() === "openai" ? "openai" : "anthropic";
  const key = (env.AI_API_KEY ?? "").trim();
  return {
    protocol,
    baseUrl: (env.AI_BASE_URL?.trim() || (protocol === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com")).replace(/\/+$/, ""),
    apiKey: key ? key : null,
    model: env.AI_MODEL?.trim() || "claude-sonnet-5-5",
    dailyTokenCap: Math.floor(num(env.AI_DAILY_TOKEN_CAP, 200_000)),
    timeoutMs: Math.floor(num(env.AI_TIMEOUT_MS, 30_000)),
    priceInPerMTok: num(env.AI_PRICE_IN_PER_MTOK, 3),
    priceOutPerMTok: num(env.AI_PRICE_OUT_PER_MTOK, 15),
    maxTokens: Math.floor(num(env.AI_MAX_TOKENS, 2_000)),
  };
}

export function endpointFor(c: AiConfig): string {
  return c.protocol === "openai" ? `${c.baseUrl}/chat/completions` : `${c.baseUrl}/v1/messages`;
}

/** Cost estimate in micro-dollars: USD per million tokens equals micro-dollars per token. */
export const costMicros = (c: AiConfig, tokensIn: number, tokensOut: number) =>
  Math.round(tokensIn * c.priceInPerMTok + tokensOut * c.priceOutPerMTok);

/** Start of the current UTC day: the daily cap resets at 00:00 UTC. */
export const utcDayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
