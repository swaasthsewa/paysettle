// F1.3, F1.5 · IDENTITY — the person's profile (users.profile): display name, currency, time zone and billing details,
// and the optional PayPal buyer e-mail. An incomplete profile is refused with ERR_103 and the list of what is missing.
import { z } from "zod";

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AUD", "CAD", "SGD", "AED"] as const;
export type Currency = (typeof CURRENCIES)[number];

let zones: Set<string> | null = null;
export function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const list = intl.supportedValuesOf?.("timeZone") ?? ["UTC", "America/New_York", "Europe/London", "Asia/Kolkata"];
  return list.includes("UTC") ? list : ["UTC", ...list];
}
export const isTimeZone = (tz: string) => (zones ??= new Set(timeZones())).has(tz);

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Add your name as it should appear on contracts.").max(80),
  currency: z.enum(CURRENCIES, { message: "Pick the currency you contract in." }),
  timezone: z.string().refine(isTimeZone, "Pick a time zone from the list."),
  billingName: z.string().trim().max(120).optional().transform((v) => v || undefined),
  billingCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use the two-letter country code for billing, for example US or IN."),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export interface StoredProfile { currency?: Currency; timezone?: string; billingName?: string; billingCountry?: string; blurb?: string; [k: string]: unknown }

/** The fields a client still has to fill before funding (ERR_103). */
export function profileGaps(p: StoredProfile): string[] {
  const g: string[] = [];
  if (!p.currency) g.push("currency");
  if (!p.timezone) g.push("time zone");
  if (!p.billingCountry) g.push("billing country");
  return g;
}

export const paypalEmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email({ message: "That is not an e-mail address PayPal would accept." }));

/**
 * F1.5 · a buyer link is optional (the client approves every hold inside PayPal); it never makes an account receivable,
 * and the e-mail counts as confirmed only after PayPal returns it with the first approval.
 */
export function buyerLink(email: string) {
  const r = paypalEmailSchema.safeParse(email);
  return r.success ? { ok: true as const, values: { email: r.data, receivable: false, emailConfirmed: false } } : { ok: false as const, message: r.error.issues[0]?.message ?? "Check the e-mail address." };
}
