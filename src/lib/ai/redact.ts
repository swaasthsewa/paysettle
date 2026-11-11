/**
 * A7 · NFR Privacy: personal data is replaced by role labels before anything is sent to a model.
 * Port of the reference redact module: people known from the users table (e-mail and name) become "client 1",
 * "provider 2", …; any other e-mail address becomes "[email]" and phone numbers become "[phone]".
 *
 * Names: the full name is matched case-insensitively; the first name alone is matched only as a capitalised whole
 * word (so "Grant" in "PAYMENT_GRANT" or "grant access" is left alone; surnames are not matched on their own).
 */
export interface Person { id: string; email: string; name: string; role: string }
export interface People { byText: { text: string; label: string; caseSensitive: boolean }[]; byId: Record<string, string> }

export const EMPTY_PEOPLE: People = { byText: [], byId: {} };

export function buildPeople(list: Person[]): People {
  const counts: Record<string, number> = {};
  const byText: People["byText"] = [];
  const byId: Record<string, string> = {};
  for (const p of [...list].sort((a, b) => a.id.localeCompare(b.id))) {
    const role = (p.role || "member").replace(/_/g, " ");
    counts[role] = (counts[role] ?? 0) + 1;
    const label = `${role} ${counts[role]}`;
    byId[p.id] = label;
    if (p.email) byText.push({ text: p.email.toLowerCase(), label, caseSensitive: false });
    const name = (p.name ?? "").trim();
    if (name.length >= 3 && name.toLowerCase() !== role) {
      byText.push({ text: name, label, caseSensitive: false });
      const first = name.split(/\s+/)[0];
      if (first && first !== name && first.length >= 3 && /^[A-Z]/.test(first)) byText.push({ text: first, label, caseSensitive: true });
    }
  }
  byText.sort((a, b) => b.text.length - a.text.length); // longest first: a full name wins over its first name
  return { byText, byId };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_CANDIDATE = /(?<![\w.,/:])\+?\(?\d[\d\s().-]{7,}\d(?![\w,/])/g;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

function looksLikePhone(s: string): boolean {
  if (ISO_DATE.test(s)) return false;
  const digits = s.replace(/\D/g, "").length;
  if (!/[\s().-]/.test(s.trim()) && !s.trim().startsWith("+")) return false; // a bare long number is an id or an amount
  return (digits >= 10 && digits <= 15) || (s.trim().startsWith("+") && digits >= 8 && digits <= 15);
}

export function redactText(value: string, people: People = EMPTY_PEOPLE): string {
  let out = value;
  for (const k of people.byText) {
    const flags = k.caseSensitive ? "g" : "gi";
    if (!k.caseSensitive && !out.toLowerCase().includes(k.text.toLowerCase())) continue;
    if (k.caseSensitive && !out.includes(k.text)) continue;
    out = out.replace(new RegExp(`(?<![\\w@.])${esc(k.text)}(?![\\w@])`, flags), k.label);
  }
  out = out.replace(EMAIL_RE, "[email]");
  out = out.replace(PHONE_CANDIDATE, (m) => {
    const lead = m.match(/^\s*/)?.[0] ?? "", trail = m.match(/\s*$/)?.[0] ?? "";
    return looksLikePhone(m) ? `${lead}[phone]${trail}` : m;
  });
  return out;
}

/** Redact every string inside a JSON value; keys ending in user/actor ids become labels. */
export function redactValue<T>(value: T, people: People = EMPTY_PEOPLE, key?: string): T {
  if (typeof value === "string") {
    if (key && /(^|_)(user|actor|signer|client|provider)_?id$/i.test(key)) return (people.byId[value] ?? "a user") as T;
    return redactText(value, people) as T;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, people, key)) as T;
  if (value && typeof value === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) o[k] = redactValue(v, people, k);
    return o as T;
  }
  return value;
}
