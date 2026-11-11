// F1.1 · IDENTITY — the self-registration form's rules. Pure: no storage, no clock.
//
// Anyone may post the form, so nothing is trusted (P11): every field is checked with zod, the password with the
// platform password policy (policy.ts: length, own name / e-mail name, most-used list, runs), the country against
// ISO 3166-1, the time zone against the platform's own list. A hidden field (the same honeypot name the waitlist uses)
// catches form-filling robots: they are told all went well and nothing is stored.
//
// Duplicate e-mail (ERR_101): the answer never says "this address has an account". It says the address cannot be
// used for a new account and points to sign-in, which is all a person who owns the address needs to know.
import { z } from "zod";
import { isCountryCode } from "./countries";
import { PASSWORD_MAX, passwordProblems } from "./policy";
import { isTimeZone } from "./profile";
import { HONEYPOT } from "./waitlist";

export { HONEYPOT };
export const REG_ROLES = ["client", "provider"] as const;
export type RegRole = (typeof REG_ROLES)[number];
export const REG_MAX = { name: 80, email: 254 } as const;
export const REG_FIELDS = ["name", "email", "password", "role", "country", "timezone", "terms"] as const;
export type RegField = (typeof REG_FIELDS)[number];

export const ERR_101 = "ERR_101";
export const DUPLICATE_MESSAGE = `${ERR_101} · We could not create an account with this e-mail address. If you already have a PaySettle account, sign in with it instead.`;

/* control characters and markup have no place in a name; links in a name are a spam pattern */
const NAME_BAD = /[\u0000-\u001f\u007f<>{}]|https?:\/\/|www\./i;

const nameSchema = z.string().trim().min(2, "Add your name as it should appear on contracts (at least 2 characters).")
  .max(REG_MAX.name, `Keep the name under ${REG_MAX.name} characters.`)
  .refine((s) => !NAME_BAD.test(s), "Use letters, spaces and ordinary punctuation in your name, without links.")
  .transform((s) => s.replace(/\s+/g, " "));
const emailSchema = z.string().trim().toLowerCase().max(REG_MAX.email, "That e-mail address is too long.").pipe(z.email({ message: "Enter an e-mail address like name@example.com." }));

export const registrationSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: z.string().max(PASSWORD_MAX * 4, "That password is too long."),
  role: z.enum(REG_ROLES, { message: "Choose whether you buy work (client) or deliver it (provider)." }),
  country: z.string().trim().toUpperCase().refine(isCountryCode, "Pick your country from the list."),
  timezone: z.string().trim().refine(isTimeZone, "Pick your time zone from the list."),
  terms: z.literal(true, { message: "Tick the box to accept the platform terms." }),
});
export type Registration = Omit<z.infer<typeof registrationSchema>, "terms">;

export type FieldErrors = Partial<Record<RegField, string[]>>;
export type RegistrationRead =
  | { ok: true; robot: false; data: Registration }
  | { ok: true; robot: true }
  | { ok: false; errors: FieldErrors };

const s = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Read a posted registration. `termsVersion` is the version the form showed; it must be the current one, so nobody
 * accepts terms they were not shown. `fixedEmail` (verified by an identity provider) replaces whatever was typed.
 */
export function readRegistration(input: Record<string, unknown>, o: { termsVersion: string; fixedEmail?: string }): RegistrationRead {
  const trap = input[HONEYPOT];
  if (typeof trap === "string" && trap.trim().length > 0) return { ok: true, robot: true };
  const errors: FieldErrors = {};
  const add = (f: RegField, m: string) => { const list = (errors[f] ??= []); if (!list.includes(m)) list.push(m); };

  const r = registrationSchema.safeParse({
    name: s(input.name), email: o.fixedEmail ?? s(input.email), password: s(input.password), role: input.role,
    country: s(input.country), timezone: s(input.timezone), terms: input.terms === "on" || input.terms === true,
  });
  if (!r.success) for (const i of r.error.issues) { const f = String(i.path[0]) as RegField; if ((REG_FIELDS as readonly string[]).includes(f)) add(f, i.message); }
  if (s(input.termsVersion) !== o.termsVersion) add("terms", "The terms changed while this page was open. Read the current version and tick the box again.");

  /* the password policy needs the name and e-mail, so it runs on whatever of them was readable */
  const pw = s(input.password);
  const ctx = { email: r.success ? r.data.email : s(input.email).trim().toLowerCase(), name: r.success ? r.data.name : s(input.name).trim() };
  for (const m of passwordProblems(pw, ctx)) add("password", m);

  if (Object.keys(errors).length || !r.success) return { ok: false, errors };
  const { terms: _t, ...data } = r.data;
  void _t;
  return { ok: true, robot: false, data };
}

/** The first problem of each field, in form order: what the error summary at the top of the form lists. */
export function errorSummary(errors: FieldErrors): { field: RegField; message: string }[] {
  return REG_FIELDS.filter((f) => errors[f]?.length).map((f) => ({ field: f, message: errors[f]![0] }));
}
