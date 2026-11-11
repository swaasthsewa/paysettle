"use server";
/**
 * F1.4 provider setup (business, category, tax id kept masked, licence fingerprints, Ops review state) and
 * F1.6 PayPal merchant link. Stored in users.profile.provider and paypal_links. Every change writes an audit row.
 * F1.4 OCR assist: when the provider allows it, the PDF text layer the browser extracted (at most 4,000 characters,
 * untrusted) and the file name are read for licence number, expiry and issuer (src/server/identity/ocr.ts: AI gateway
 * with a rule fallback). Only the suggestion is stored, never the text; Ops sees it as advice at review.
 *
 * States: PENDING (details missing) → SUBMITTED (complete, waiting for Ops) → PROVIDER_VALIDATED (set by Ops in the
 * Ops console). A tax id changed after validation sends the provider back to SUBMITTED for a fresh review.
 * Merchant link: in the sandbox the business account e-mail is saved with receivable = true; production uses PayPal
 * partner onboarding (Partner Referrals), which confirms the account can receive before payouts switch on (ERR_106).
 */
import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { paypalLinks, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { sandboxMode } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { requireViewer, type Viewer } from "@/lib/session";
import { paypalEmailSchema } from "@/lib/identity/profile";
import { businessSchema, isValidated, licenceSchema, maskTaxId, merchantLink, missingCredentials, taxIdFingerprint, type LicenceRecord, type ProviderProfile } from "@/lib/identity/provider";
import { suggestLicenceFields } from "@/server/identity/ocr";
import type { ActionAnswer } from "@/components/identity/action-form";

const str = (f: FormData, k: string) => { const x = f.get(k); return typeof x === "string" ? x : ""; };
const actor = (v: Viewer) => ({ id: v.id, role: v.role });
const MAX_LICENCES = 10;

async function load(v: Viewer) {
  const [u] = await db.select().from(users).where(eq(users.id, v.id)).limit(1);
  if (!u) throw new Error("account not found");
  const p = ((u.profile as { provider?: Partial<ProviderProfile> }).provider ?? {}) as Partial<ProviderProfile>;
  const [m] = await db.select().from(paypalLinks).where(and(eq(paypalLinks.userId, v.id), eq(paypalLinks.kind, "merchant"))).limit(1);
  return { u, p, merchant: m ?? null };
}

async function saveProvider(v: Viewer, next: Partial<ProviderProfile>, reReview = false) {
  const { u, merchant } = await load(v);
  const missing = missingCredentials(next, Boolean(merchant?.receivable));
  let state = u.onboardingState;
  if (missing.length === 0 && (state === "PENDING" || state === "LOCKED" || (reReview && isValidated(state)))) state = "SUBMITTED";
  if (missing.length > 0 && state === "SUBMITTED") state = "PENDING";
  const record = { ...next, ...(state === "SUBMITTED" && u.onboardingState !== "SUBMITTED" ? { submittedAt: new Date().toISOString() } : {}) };
  await db.update(users).set({ onboardingState: state, profile: sql`${users.profile} || ${JSON.stringify({ provider: record })}::jsonb` }).where(eq(users.id, v.id));
  if (state !== u.onboardingState) await audit(db, actor(v), "identity.onboarding_state", v.id, { from: u.onboardingState, to: state, missing });
  revalidatePath("/provider/onboarding");
  revalidatePath("/provider");
  return { state, missing };
}

const stateLine = (s: { state: string; missing: string[] }) =>
  s.state === "SUBMITTED" ? "Everything Ops needs is in. Ops reviews new providers before the first payout."
    : s.missing.length ? `Still needed: ${s.missing.join("; ")}.` : "Saved.";

export async function saveBusiness(_p: ActionAnswer | null, f: FormData): Promise<ActionAnswer> {
  const v = await requireViewer(["provider"]);
  const r = businessSchema.safeParse({ businessName: str(f, "businessName"), category: str(f, "category"), country: str(f, "country"), taxId: str(f, "taxId") || undefined });
  if (!r.success) return { ok: false, message: "ERR_104 · Some details are missing or not in the expected form.", problems: [...new Set(r.error.issues.map((i) => i.message))] };
  const { p } = await load(v);
  const next: Partial<ProviderProfile> = { ...p, businessName: r.data.businessName, category: r.data.category, country: r.data.country };
  let changedTax = false;
  if (r.data.taxId) {
    if (r.data.taxId.replace(/[^A-Za-z0-9]/g, "").length < 5) return { ok: false, message: "A tax id has at least 5 letters or digits." };
    const fp = taxIdFingerprint(r.data.taxId);
    const [dupe] = await db.select({ id: users.id }).from(users).where(and(ne(users.id, v.id), sql`${users.profile}->'provider'->>'taxIdFingerprint' = ${fp}`)).limit(1);
    if (dupe) {
      await audit(db, actor(v), "identity.taxid_duplicate", v.id, {});
      return { ok: false, message: "This tax id is already registered to another provider account. Ops can help if the business changed hands." };
    }
    changedTax = fp !== p.taxIdFingerprint;
    next.taxIdMasked = maskTaxId(r.data.taxId);
    next.taxIdFingerprint = fp;
  }
  const s = await saveProvider(v, next, changedTax && Boolean(p.taxIdFingerprint));
  await audit(db, actor(v), "identity.provider_business_saved", v.id, { category: r.data.category, country: r.data.country, taxId: changedTax ? "changed" : "kept" });
  return { ok: true, message: `Saved${next.taxIdMasked ? `; the tax id is kept only as ${next.taxIdMasked}` : ""}. ${stateLine(s)}` };
}

export async function addLicence(_p: ActionAnswer | null, f: FormData): Promise<ActionAnswer> {
  const v = await requireViewer(["provider"]);
  const allowRead = str(f, "ocr") === "on";
  const r = licenceSchema.safeParse({ name: str(f, "name"), kind: str(f, "kind"), size: Number(str(f, "size")), sha256: str(f, "sha256").toLowerCase(), text: allowRead ? str(f, "text") || undefined : undefined });
  if (!r.success) return { ok: false, message: "That file was not added.", problems: [...new Set(r.error.issues.map((i) => i.message))] };
  const { p } = await load(v);
  const list = p.licences ?? [];
  if (list.some((l) => l.sha256 === r.data.sha256)) return { ok: false, message: "This exact file is already on the list." };
  if (list.length >= MAX_LICENCES) return { ok: false, message: `Up to ${MAX_LICENCES} documents. Remove one first.` };
  const suggest = allowRead ? await suggestLicenceFields({ filename: r.data.name, text: r.data.text }) : undefined;
  const rec: LicenceRecord = { id: newId("lic"), name: r.data.name, kind: r.data.kind, size: r.data.size, sha256: r.data.sha256, at: new Date().toISOString(), review: "QUEUED", ...(suggest ? { suggest } : {}) };
  const s = await saveProvider(v, { ...p, licences: [...list, rec] });
  await audit(db, actor(v), "identity.licence_added", v.id, { licence: rec.id, sha256: rec.sha256, kind: rec.kind, size: rec.size, ocr: suggest ? { model: suggest.model, fields: Object.keys(suggest.sources), textChars: suggest.textChars } : "off" });
  const read = suggest && Object.keys(suggest.sources).length ? ` We read ${Object.keys(suggest.sources).join(", ")} from it as a suggestion for Ops.` : "";
  return { ok: true, message: `Added ${rec.name}. It is queued for Ops review.${read} ${stateLine(s)}` };
}

export async function removeLicence(f: FormData): Promise<void> {
  const v = await requireViewer(["provider"]);
  const id = str(f, "id");
  const { p } = await load(v);
  const list = p.licences ?? [];
  if (!list.some((l) => l.id === id)) return;
  await saveProvider(v, { ...p, licences: list.filter((l) => l.id !== id) });
  await audit(db, actor(v), "identity.licence_removed", v.id, { licence: id });
}

export async function saveMerchant(_p: ActionAnswer | null, f: FormData): Promise<ActionAnswer> {
  const v = await requireViewer(["provider"]);
  const r = paypalEmailSchema.safeParse(str(f, "email"));
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Check the e-mail address." };
  const sandbox = sandboxMode();
  const { merchant } = await load(v);
  /* sandbox: the Sandbox business account is taken as able to receive. Production: receivable stays false until PayPal partner onboarding confirms it. */
  const values = { ...merchantLink(r.data, sandbox), merchantId: merchant?.merchantId ?? null };
  if (merchant) await db.update(paypalLinks).set(values).where(eq(paypalLinks.id, merchant.id));
  else await db.insert(paypalLinks).values({ id: newId("pl"), userId: v.id, kind: "merchant", ...values });
  await audit(db, actor(v), "identity.paypal_merchant_linked", v.id, { sandbox, receivable: sandbox });
  const { p } = await load(v);
  const s = await saveProvider(v, p);
  return sandbox
    ? { ok: true, message: `Linked ${r.data} as a PayPal Sandbox business account that can receive. ${stateLine(s)}` }
    : { ok: true, message: `Saved ${r.data}. Payouts switch on when PayPal confirms the account through partner onboarding (ERR_106 until then).` };
}
