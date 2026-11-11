/**
 * Demo seeds always run on the mock rail, whatever PayPal credentials are set in the environment (F3.01 P9).
 * The seeds fund and confirm holds in one go (seed-link, seed-money, seed-deadline…); against PayPal Sandbox that fails
 * with ORDER_NOT_APPROVED, because nobody approves the order in a browser. Import this module FIRST in every seed script:
 * it blanks the PayPal credentials for the seed process, so createWorkspace picks rail MOCK and railFor() returns the mock.
 * Blank (not deleted) values also win over `--env-file`, which never overrides a variable that is already set.
 */
export const PAYPAL_ENV_KEYS = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_RAIL", "PAYPAL_WEBHOOK_ID"] as const;

/** A copy of `env` with the PayPal credentials blanked (for child seed processes). */
export function demoSeedEnv<E extends Record<string, string | undefined>>(env: E): E {
  const out: Record<string, string | undefined> = { ...env };
  for (const k of PAYPAL_ENV_KEYS) out[k] = "";
  return out as E;
}

/** Blanks the PayPal credentials in this process. */
export function forceMockRail(env: NodeJS.ProcessEnv = process.env): void {
  for (const k of PAYPAL_ENV_KEYS) env[k] = "";
}

forceMockRail();
