// F1.4, F1.6 · IDENTITY — provider setup: the business record kept in users.profile.provider, the tax id kept only
// masked (plus a salted fingerprint for duplicate checks), licence files kept only as SHA-256 fingerprints, and the
// onboarding states. Pure: no storage here.
import { z } from "zod";
import { sha256 } from "@/lib/ids";
import type { LicenceSuggestion } from "./ocr";

export const PROVIDER_CATEGORIES = [
  { code: "software", label: "Software and web development" },
  { code: "consulting", label: "Enterprise software consulting (ERP, planning, analytics)" },
  { code: "design", label: "Interior design and millwork" },
  { code: "automotive", label: "Vehicle restoration and modification" },
  { code: "travel", label: "Travel and custom tours" },
  { code: "construction", label: "Site work and construction" },
  { code: "creative", label: "Creative, media and marketing" },
  { code: "other", label: "Other professional services" },
] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number]["code"];

/** Onboarding states (F1.4). ACTIVE is the seed's name for a provider validated before this screen existed. */
export const ONBOARDING = {
  PENDING: { label: "Pending: details needed", b: "warn" },
  SUBMITTED: { label: "Submitted: waiting for Ops review", b: "plain" },
  PROVIDER_VALIDATED: { label: "Validated by Ops", b: "ok" },
  ACTIVE: { label: "Validated by Ops", b: "ok" },
  LOCKED: { label: "Locked: credentials missing (ERR_104)", b: "danger" },
} as const satisfies Record<string, { label: string; b: string }>;
export const onboardingChip = (state: string) => ONBOARDING[state as keyof typeof ONBOARDING] ?? { label: state, b: "plain" };
export const isValidated = (state: string) => state === "PROVIDER_VALIDATED" || state === "ACTIVE";

/** `suggest` (F1.4 OCR assist): licence number, expiry and issuer read from the file name and text layer, advisory for Ops. */
export interface LicenceRecord { id: string; name: string; kind: string; size: number; sha256: string; at: string; review: "QUEUED" | "ACCEPTED" | "REJECTED"; suggest?: LicenceSuggestion }
export interface ProviderProfile {
  businessName: string; category: ProviderCategory; country: string;
  taxIdMasked: string; taxIdFingerprint: string; licences: LicenceRecord[]; submittedAt?: string;
}

/** Keep the last four characters, mask the rest, keep separators so the shape stays recognisable. */
export function maskTaxId(raw: string): string {
  const clean = raw.trim().toUpperCase();
  const alnum = clean.replace(/[^A-Z0-9]/g, "");
  if (alnum.length <= 4) return "•".repeat(alnum.length);
  let keep = 4, out = "";
  for (let i = clean.length - 1; i >= 0; i--) {
    const ch = clean[i];
    if (/[A-Z0-9]/.test(ch)) { out = (keep > 0 ? ch : "•") + out; keep--; } else out = ch + out;
  }
  return out;
}
/** A fingerprint of the tax id for duplicate detection: never reversible to the number, salted per deployment. */
export const taxIdFingerprint = (raw: string, salt = process.env.PAYSETTLE_TAXID_SALT ?? "paysettle-sandbox") =>
  sha256(`${salt}:${raw.toUpperCase().replace(/[^A-Z0-9]/g, "")}`);

export const businessSchema = z.object({
  businessName: z.string().trim().min(2, "Give the business name as it appears on your PayPal account.").max(120),
  category: z.enum(PROVIDER_CATEGORIES.map((c) => c.code) as [ProviderCategory, ...ProviderCategory[]], { message: "Pick the category closest to your work." }),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use the two-letter country code, for example US or IN."),
  taxId: z.string().trim().max(40).regex(/^[A-Za-z0-9 .\/-]*$/, "A tax id uses letters, digits, spaces, dots, dashes or slashes.").optional(),
});

/** Licence files accepted for review (P11: type and size are checked; the file itself never leaves the person's device). */
export const LICENCE_KINDS = ["application/pdf", "image/png", "image/jpeg"] as const;
export const LICENCE_MAX_BYTES = 10 * 1024 * 1024;
export const licenceSchema = z.object({
  name: z.string().trim().min(1).max(160).transform((s) => s.replace(/[^\w .()-]/g, "_")),
  kind: z.enum(LICENCE_KINDS, { message: "Licences are accepted as PDF, PNG or JPEG." }),
  size: z.number().int().positive().max(LICENCE_MAX_BYTES, "Licence files are limited to 10 MB."),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, "The file fingerprint is not a SHA-256 value."),
  /* F1.4 OCR assist: up to 4,000 characters of the PDF's text layer, only when the person allowed it (P11: untrusted) */
  text: z.string().max(4_000, "The text sent with the file is limited to 4,000 characters.").optional(),
});

/** What is still missing before Ops can validate (ERR_104 when a provider tries to take payouts without it). */
export function missingCredentials(p: Partial<ProviderProfile> | undefined, merchantLinked: boolean): string[] {
  const m: string[] = [];
  if (!p?.businessName) m.push("Business name and category");
  if (!p?.taxIdMasked) m.push("Tax id");
  if (!p?.licences?.length) m.push("At least one licence or registration document");
  if (!merchantLinked) m.push("PayPal business account that can receive payments");
  return m;
}

/**
 * F1.6 · what a saved merchant link records. Sandbox: the PayPal Sandbox business account is taken as able to receive,
 * so demo releases can be captured to it. Production: receivable and email_confirmed stay false until PayPal partner
 * onboarding (Partner Referrals) confirms the account; payout features stay off meanwhile (ERR_106).
 */
export function merchantLink(email: string, sandbox: boolean) {
  return { email: email.trim().toLowerCase(), receivable: sandbox, emailConfirmed: sandbox };
}
