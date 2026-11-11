// v1.81 · IDENTITY AND ACCESS — passwords: what is acceptable, how one is stored, and its history.
//
// STORAGE. scrypt with a per-password salt. The format carries its own cost parameters
// ('scrypt$N$r$p$salt$hash') so the cost can be raised later without a flag day; the older 'salt:hash'
// format (N=16384) is still verified and is REPLACED by the current format the next time its owner signs in.
// The cost used here is N=2^17, r=8, p=1 — the first choice of the OWASP password-storage guidance for scrypt.
//
// ACCEPTANCE. Length and character classes from the workspace's policy; the password may not contain the
// person's own e-mail name or company; and — following NIST SP 800-63B — a password found in the dictionary
// of commonly used passwords is refused whatever its length.
import { scrypt, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';



export const SCRYPT = { N: 1 << 17, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 } as const;

function scryptAsync(pw: string, salt: string, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(pw, salt, keylen, { N, r, p, maxmem: SCRYPT.maxmem }, (e, k) => (e ? reject(e) : resolve(k))));
}

/** Hash a password in the current format. */
export async function hashPasswordStrong(pw: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(pw, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${key.toString('hex')}`;
}

/** Does `pw` match `stored`? Understands both formats. Never throws on a malformed stored value. */
export async function verifyPasswordAny(pw: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  try {
    if (stored.startsWith('scrypt$')) {
      const [, n, r, p, salt, hash] = stored.split('$');
      const N = Number(n), R = Number(r), P = Number(p);
      if (!salt || !hash || !Number.isInteger(N) || N < 16384 || N > (1 << 20) || R !== 8 || P < 1 || P > 4) return false;
      const ref = Buffer.from(hash, 'hex');
      const test = await scryptAsync(pw, salt, N, R, P, ref.length);
      return test.length === ref.length && timingSafeEqual(test, ref);
    }
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const ref = Buffer.from(hash, 'hex');
    const test = scryptSync(pw, salt, 32);
    return test.length === ref.length && timingSafeEqual(test, ref);
  } catch { return false; }
}

/** A stored hash in an older format or at a lower cost than today's. */
export const needsRehash = (stored: string): boolean => !stored.startsWith(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$`);

