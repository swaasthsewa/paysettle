// F1.4 · OCR assist for licence uploads — the rule-based reader. Pure: no storage, no clock (the caller passes "today").
//
// What it reads: the licence or registration NUMBER, the EXPIRY date and the ISSUER, from the file name and from the
// text layer of a PDF (extracted in the browser, at most TEXT_MAX characters; the file itself stays on the device).
// What it is for: suggestions shown to Ops beside the document at review. Ops decides; nothing here changes a review
// state, a trust tier or a payout (P3-style advisory). Everything read is untrusted (P11): values are cut to fixed
// lengths, limited to plain characters, and a date that cannot be a real calendar date is dropped.
//
// The AI gateway path (src/server/identity/ocr.ts) uses the same output shape and is grounded against this text.

export const TEXT_MAX = 4_000;
export const FIELD_MAX = { number: 40, issuer: 100 } as const;

export type FieldSource = "text" | "filename";
export interface Read<T> { value: T; source: FieldSource; confidence: number }
export interface LicenceFields { number?: Read<string>; expiry?: Read<string>; issuer?: Read<string> }
export interface LicenceFlags { expired: boolean; expiresSoon: boolean }
/** What is stored with a licence record (users.profile.provider.licences[].suggest) and shown to Ops. */
export interface LicenceSuggestion {
  number?: string; expiry?: string; issuer?: string;
  sources: Partial<Record<"number" | "expiry" | "issuer", "ai" | "text" | "filename">>;
  model: string; confidence: number; textChars: number; injection?: boolean; at: string;
}


const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Plain text only: no control characters, collapsed spaces. */
export function cleanText(raw: string, max = TEXT_MAX): string {
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

const pad = (n: number) => String(n).padStart(2, "0");
function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthOf = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;

/**
 * One date in common licence formats → YYYY-MM-DD. For d/m/y, a number above 12 is the day (12/31/2027 → 31 December
 * 2027); when both could be a month the day comes first (03/04/2027 → 3 April 2027), as most licensing bodies outside
 * the US write it. A month and year only ("03/2027", "March 2027") means the last day of that month.
 */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return isoDate(+m[1], +m[2], +m[3]);
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) return isoDate(+m[1], +m[2], +m[3]);
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    const a = +m[1], b = +m[2], y = +m[3];
    return a > 12 ? isoDate(y, b, a) : b > 12 ? isoDate(y, a, b) : isoDate(y, b, a);
  }
  if ((m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/))) { const mo = monthOf(m[2]); return mo ? isoDate(+m[3], mo, +m[1]) : null; }
  if ((m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) { const mo = monthOf(m[1]); return mo ? isoDate(+m[3], mo, +m[2]) : null; }
  if ((m = t.match(/^(\d{1,2})[-/.](\d{4})$/))) { const mo = +m[1], y = +m[2]; return mo >= 1 && mo <= 12 ? isoDate(y, mo, lastDay(y, mo)) : null; }
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})$/))) { const y = +m[1], mo = +m[2]; return mo >= 1 && mo <= 12 ? isoDate(y, mo, lastDay(y, mo)) : null; }
  if ((m = t.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) { const mo = monthOf(m[1]), y = +m[2]; return mo ? isoDate(y, mo, lastDay(y, mo)) : null; }
  return null;
}

const DATE_RE = String.raw`(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}\.?,?[\s-]+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[-/.]\d{4}|[A-Za-z]{3,9}\.?,?\s+\d{4})`;
const EXPIRY_LABEL = String.raw`(?:expir(?:y|es|ation)(?:\s+date)?|exp\.?\s*date|valid\s+(?:until|till|thru|through|up\s*to|upto|to)|date\s+of\s+expiry|renewal\s+due|valid\s+through)`;
const NUMBER_LABEL = String.raw`(?:licen[cs]e|registration|reg\.?|certificate|cert\.?|permit|gstin|cin|ein|company|business)\s*(?:no\.?|number|num\.?|#|id)?`;
const ID_TOKEN = String.raw`([A-Z0-9][A-Z0-9/-]{3,38}[A-Z0-9])`;

const normId = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const looksLikeId = (s: string) => /\d/.test(s) && normId(s).length >= 5 && normId(s).length <= FIELD_MAX.number && !parseDate(s);

function fromText(text: string): LicenceFields {
  const out: LicenceFields = {};
  const exp = text.match(new RegExp(`${EXPIRY_LABEL}\\s*[:\\-]?\\s*${DATE_RE}`, "i"));
  if (exp) { const d = parseDate(exp[1]); if (d) out.expiry = { value: d, source: "text", confidence: 0.8 }; }
  const numRe = new RegExp(`\\b${NUMBER_LABEL}\\s*[:\\-]?\\s*${ID_TOKEN}`, "gi");
  for (const m of text.matchAll(numRe)) {
    const cand = m[1].toUpperCase();
    if (looksLikeId(cand)) { out.number = { value: cand.slice(0, FIELD_MAX.number), source: "text", confidence: 0.8 }; break; }
  }
  const iss = text.match(/(?:issued\s+by|issuing\s+(?:authority|body|office)|issuer)\s*[:\-]?\s*([^\n]{3,120})/i);
  if (iss) out.issuer = { value: cleanIssuer(iss[1]), source: "text", confidence: 0.75 };
  else {
    const line = text.split(/\n|\s{3,}/).map((l) => l.trim()).find((l) => l.length >= 6 && l.length <= 120 && /\b(department|ministry|authority|council|board|bureau|commission|municipal|registrar|government|chamber of commerce|corporation of|state of|licensing)\b/i.test(l));
    if (line) out.issuer = { value: cleanIssuer(line), source: "text", confidence: 0.45 };
  }
  if (out.issuer && out.issuer.value.length < 3) delete out.issuer;
  return out;
}

function cleanIssuer(s: string): string {
  return s.replace(/\b(?:on|dated?)\s+\d.*$/i, "").replace(/[^\p{L}\p{N} .,&()'/-]/gu, " ").replace(/\s+/g, " ").trim().replace(/[.,;:\s]+$/, "").slice(0, FIELD_MAX.issuer);
}

function fromFilename(name: string): LicenceFields {
  const out: LicenceFields = {};
  const base = name.replace(/\.[A-Za-z0-9]{2,5}$/, "");
  const e = base.match(/(?:exp(?:iry|ires)?|valid(?:[-_ ]?(?:to|until|till))?)[-_ ]?(\d{4}[-_.]?\d{2}(?:[-_.]?\d{2})?)/i);
  if (e) {
    const digits = e[1].replace(/[-_.]/g, "");
    const d = digits.length === 8 ? parseDate(digits) : parseDate(`${digits.slice(0, 4)}-${digits.slice(4, 6)}`);
    if (d) out.expiry = { value: d, source: "filename", confidence: 0.4 };
  }
  const rest = e ? base.replace(e[0], " ") : base; // the expiry's digits are not a licence number
  const tokens = rest.split(/[\s_]+/).map((t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")).filter((t) => /\d/.test(t) && /^[A-Za-z0-9-]+$/.test(t));
  const num = tokens.map((t) => t.toUpperCase())
    .filter((t) => looksLikeId(t) && !/^(?:EXP|VALID)/i.test(t) && !/^\d{4}([-.]\d{1,2}){0,2}$/.test(t) && !/^(?:19|20)\d{6}$/.test(t))
    .sort((a, b) => normId(b).length - normId(a).length)[0];
  if (num) out.number = { value: num.slice(0, FIELD_MAX.number), source: "filename", confidence: 0.4 };
  return out;
}

/** Rule-based suggestion from a file name and an optional text layer. Text beats file name, field by field. */
export function readLicenceFields(p: { filename: string; text?: string | null }): LicenceFields {
  const t = p.text ? fromText(cleanText(p.text)) : {};
  const f = fromFilename(cleanText(p.filename, 200));
  return { number: t.number ?? f.number, expiry: t.expiry ?? f.expiry, issuer: t.issuer };
}

/** Expired, or expiring within 30 days, as of `todayIso` (YYYY-MM-DD). */
export function licenceFlags(expiry: string | undefined, todayIso: string): LicenceFlags {
  if (!expiry) return { expired: false, expiresSoon: false };
  const days = (Date.parse(expiry + "T00:00:00Z") - Date.parse(todayIso + "T00:00:00Z")) / 86_400_000;
  return { expired: days < 0, expiresSoon: days >= 0 && days <= 30 };
}

/** Is `value` actually present in the material (ignoring case, spaces and punctuation)? Used to ground AI answers. */
export function grounded(value: string, material: string): boolean {
  const v = normId(value);
  return v.length >= 3 && normId(material).includes(v);
}
