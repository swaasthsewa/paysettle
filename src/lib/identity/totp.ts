// v1.81 · IDENTITY AND ACCESS — the authenticator-app second factor (RFC 6238 over RFC 4226), and recovery codes.
//
// PURE: no clock is read here (the caller passes the time) and nothing is stored here.
//   · 6 digits, 30-second step, HMAC-SHA-1 — the parameters every authenticator app implements.
//   · a code is accepted for its own step and one step either side (clock drift), and a step that was
//     already used is refused: the caller stores the last accepted step and passes it back.
//   · recovery codes: 10 codes of 10 characters from an alphabet without look-alikes; only their hashes
//     are kept, and each works once.
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('not a base32 value');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const TOTP = { digits: 6, stepSeconds: 30, window: 1 } as const;

/** RFC 4226 — the one-time code for a counter. */
export function hotp(secret: Buffer, counter: number, digits: number = TOTP.digits): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepOf = (atMs: number): number => Math.floor(atMs / 1000 / TOTP.stepSeconds);
export const totpAt = (secretBase32: string, atMs: number): string => hotp(base32Decode(secretBase32), stepOf(atMs));

/** Is `code` right at `atMs`? Returns the step it matched — to be stored as the last used step — or a refusal.
 *  A code for a step at or before `lastStep` is refused even when it is otherwise right (it was already used). */
export function verifyTotp(secretBase32: string, code: string, atMs: number, lastStep = 0): { ok: true; step: number } | { ok: false; reason: 'format' | 'wrong' | 'used' } {
  const c = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return { ok: false, reason: 'format' };
  const secret = base32Decode(secretBase32);
  const now = stepOf(atMs);
  let used = false;
  for (let d = -TOTP.window; d <= TOTP.window; d++) {
    const step = now + d;
    const expect = Buffer.from(hotp(secret, step));
    if (expect.length === c.length && timingSafeEqual(expect, Buffer.from(c))) {
      if (step <= lastStep) { used = true; continue; }
      return { ok: true, step };
    }
  }
  return { ok: false, reason: used ? 'used' : 'wrong' };
}

/** A new secret (160 bits, the RFC's recommended length), as base32. */
export const newTotpSecret = (): string => base32Encode(randomBytes(20));

/** The otpauth:// address an authenticator app reads from a QR code. */
export function otpauthUri(p: { secretBase32: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(p.issuer)}:${encodeURIComponent(p.account)}`;
  return `otpauth://totp/${label}?secret=${p.secretBase32}&issuer=${encodeURIComponent(p.issuer)}&algorithm=SHA1&digits=${TOTP.digits}&period=${TOTP.stepSeconds}`;
}

const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const b = randomBytes(10);
    const s = Array.from(b, (x) => RC_ALPHABET[x % RC_ALPHABET.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
export const normalizeRecoveryCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const recoveryCodeHash = (code: string): string => createHash('sha256').update(`siq-recovery:${normalizeRecoveryCode(code)}`).digest('hex');
