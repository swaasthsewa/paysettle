// F1.2 · tests: recovery codes are issued ten at a time, stored only as hashes, and each works once.
import { describe, expect, it } from "vitest";
import { issueRecoveryCodes, memoryRecoveryStore, redeemRecoveryCode } from "./recovery";
import { recoveryCodeHash } from "./totp";

const AT = new Date("2026-11-08T12:00:00Z");

describe("F1.2 recovery codes", () => {
  it("F1.2 issues 10 distinct codes and stores only their hashes", async () => {
    const store = memoryRecoveryStore();
    const codes = await issueRecoveryCodes(store, "u1");
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(store.rows.map((r) => r.codeHash)).toEqual(codes.map(recoveryCodeHash));
    expect(store.rows.some((r) => codes.includes(r.codeHash))).toBe(false);
  });

  it("F1.2 a code works once; the second use is refused", async () => {
    const store = memoryRecoveryStore();
    const [code] = await issueRecoveryCodes(store, "u1");
    expect(await redeemRecoveryCode(store, "u1", code, AT)).toEqual({ ok: true, remaining: 9 });
    expect(await redeemRecoveryCode(store, "u1", code, AT)).toEqual({ ok: false, reason: "unknown" });
  });

  it("F1.2 spacing and case do not matter; another person's code is refused", async () => {
    const store = memoryRecoveryStore();
    const [a] = await issueRecoveryCodes(store, "u1");
    const [b] = await issueRecoveryCodes(store, "u2");
    expect(await redeemRecoveryCode(store, "u1", b, AT)).toEqual({ ok: false, reason: "unknown" });
    expect(await redeemRecoveryCode(store, "u1", ` ${a.toLowerCase().replace("-", " ")} `, AT)).toMatchObject({ ok: true });
    expect(await redeemRecoveryCode(store, "u1", "short", AT)).toEqual({ ok: false, reason: "format" });
  });

  it("F1.2 making new codes voids every earlier one", async () => {
    const store = memoryRecoveryStore();
    const old = await issueRecoveryCodes(store, "u1");
    const fresh = await issueRecoveryCodes(store, "u1");
    expect(await redeemRecoveryCode(store, "u1", old[0], AT)).toEqual({ ok: false, reason: "unknown" });
    expect(await redeemRecoveryCode(store, "u1", fresh[0], AT)).toMatchObject({ ok: true, remaining: 9 });
  });
});
