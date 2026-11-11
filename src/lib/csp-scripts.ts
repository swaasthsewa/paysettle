/**
 * NFR security · the rule for scripts in the page rules (Content-Security-Policy with nonces). Every page is drawn on
 * request, so each one gets a fresh random nonce in the proxy (src/proxy.ts): Next.js reads it from the request's rule
 * and puts it on its own scripts, and our two start-up scripts (the colour theme and the folded menu) read it with
 * `scriptNonce()`. A script with no nonce, such as one slipped into a page, is refused. 'strict-dynamic' lets the
 * trusted scripts load the framework's chunks; `https:` is only a fallback for browsers that predate 'strict-dynamic'.
 *
 * CSP_SCRIPTS says how far it goes: "enforce" (the default) refuses a script without the nonce, "report" only reports
 * it in the browser's console (for trying a change on staging first), "off" leaves the rule out.
 */
export type ScriptRuleMode = "off" | "report" | "enforce";
export const NONCE_HEADER = "x-nonce";

export const scriptRuleMode = (v = process.env.CSP_SCRIPTS): ScriptRuleMode => (v === "off" || v === "report" ? v : "enforce");

export function newNonce(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

export function scriptRule(nonce: string, dev = process.env.NODE_ENV === "development"): string {
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""} https:`,
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

/** The header that carries the rule, for the mode. */
export const scriptRuleHeader = (mode: ScriptRuleMode) => (mode === "enforce" ? "content-security-policy" : "content-security-policy-report-only");
