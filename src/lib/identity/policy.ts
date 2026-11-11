// F1.1, F1.2 · IDENTITY — the password policy for PaySettle accounts. Pure: no storage, no clock.
//
//   · at least 12 characters, at most 128 (scrypt input stays bounded)
//   · may not contain the person's own e-mail name (the part before @) or their first or last name
//   · may not be one of the passwords people use most often (NIST SP 800-63B: check against a list of known-bad values)
//   · may not be one character repeated, or a straight run like "123456789012"
//
// The answer is a list of plain reasons, empty when the password is acceptable.

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** A short list of the most used passwords and their usual twelve-character stretches. Lower case. */
const COMMON = new Set([
  "password1234", "password12345", "passwordpassword", "123456789012", "1234567890123", "qwertyuiopas", "qwerty123456",
  "iloveyou1234", "letmein12345", "welcome12345", "administrator", "changeme1234", "paysettle123", "paysettle1234",
  "abc123456789", "aaaaaaaaaaaa", "111111111111", "000000000000", "trustno11234", "monkey123456", "football1234",
  "baseball1234", "sunshine1234", "princess1234", "superman1234", "starwars1234", "dragon123456", "master123456",
]);

export interface PolicyContext { email?: string | null; name?: string | null }

const straightRun = (s: string) => {
  if (s.length < 6) return false;
  const codes = [...s].map((c) => c.charCodeAt(0));
  const up = codes.every((c, i) => i === 0 || c - codes[i - 1] === 1);
  const down = codes.every((c, i) => i === 0 || c - codes[i - 1] === -1);
  return up || down;
};

/** The parts of a person's identity a password must not contain: the e-mail name and each name of 3+ letters. */
export function personalParts(ctx: PolicyContext): string[] {
  const parts = new Set<string>();
  const local = (ctx.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 3) parts.add(local);
  for (const piece of local.split(/[._+-]+/)) if (piece.length >= 3) parts.add(piece);
  for (const piece of (ctx.name ?? "").toLowerCase().split(/\s+/)) if (piece.length >= 3) parts.add(piece);
  return [...parts];
}

export function passwordProblems(pw: string, ctx: PolicyContext = {}): string[] {
  const out: string[] = [];
  if (pw.length < PASSWORD_MIN) out.push(`Use at least ${PASSWORD_MIN} characters (this one has ${pw.length}).`);
  if (pw.length > PASSWORD_MAX) out.push(`Use at most ${PASSWORD_MAX} characters.`);
  const low = pw.toLowerCase();
  const own = personalParts(ctx).find((p) => low.includes(p));
  if (own) out.push("Leave your e-mail name and your own name out of the password.");
  if (COMMON.has(low)) out.push("This password is on the list of the most used passwords. Pick another.");
  else if (pw.length > 0 && (new Set(pw).size === 1 || straightRun(pw))) out.push("A single repeated character or a straight run is too easy to guess.");
  return out;
}

export const passwordAcceptable = (pw: string, ctx: PolicyContext = {}) => passwordProblems(pw, ctx).length === 0;
