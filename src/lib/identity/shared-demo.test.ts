/**
 * P9 shared demo: every judge signs in as the same seeded people, so in the sandbox a persona-picker session cannot
 * change that person's settings (account, provider onboarding, mediator profile), and declining the terms does not
 * write a DECLINED record for everyone. The actions answer before touching the database.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  viewer: { id: "u_priya", orgId: "org_demo", name: "Priya", email: "priya@demo.test", role: "client", persona: "1-client", demo: true, mfa: true, tier: "standard" },
  db: vi.fn(() => { throw new Error("the database was touched"); }),
  record: vi.fn(), end: vi.fn(), clear: vi.fn(), audit: vi.fn(), setAvailability: vi.fn(), updateProfile: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }), headers: async () => new Headers() }));
vi.mock("@/db/client", () => ({ db: { select: h.db, insert: h.db, update: h.db, delete: h.db, transaction: h.db, execute: h.db } }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/session")>()),
  requireViewer: async () => h.viewer, viewer: async () => h.viewer, endSession: h.end, clientInfo: async () => ({ ip: "local", userAgent: "test" }),
}));
vi.mock("@/lib/identity/handshake", async (orig) => ({ ...(await orig<typeof import("@/lib/identity/handshake")>()), recordTermsDecision: h.record }));
vi.mock("@/lib/identity/handshake-session", () => ({ pendingHandshake: async () => null, clearHandshake: h.clear }));
vi.mock("@/server/mediators/index", () => ({ setAvailability: h.setAvailability, updateProfile: h.updateProfile }));

import { changePassword, endOtherSessions, saveBuyerLink, saveProfile, startMfa } from "@/app/(app)/account/actions";
import { saveBusiness, saveMerchant } from "@/app/(app)/provider/onboarding/actions";
import { availabilityAction } from "@/server/mediators/actions";
import { declineTerms } from "@/app/(auth)/terms-accept/actions";

const READ_ONLY = { ok: false, message: "Shared demo person: settings are read-only." };
const form = (o: Record<string, string> = {}) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const target = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as { to?: string }).to ?? String(e); } };
afterEach(() => { vi.clearAllMocks(); h.viewer.role = "client"; });

describe("P9 shared demo people are read-only in the sandbox", () => {
  it("P9 account: profile, PayPal e-mail, authenticator, password and other sessions are refused", async () => {
    expect(await saveProfile(null, form({ name: "Someone else", currency: "USD", timezone: "UTC", billingCountry: "US" }))).toEqual(READ_ONLY);
    expect(await saveBuyerLink(null, form({ email: "other@example.com" }))).toEqual(READ_ONLY);
    expect(await startMfa()).toEqual(READ_ONLY);
    expect(await changePassword(null, form({ current: "x", next: "a long new passphrase", again: "a long new passphrase" }))).toEqual(READ_ONLY);
    await endOtherSessions();
    expect(h.db).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("P9 provider onboarding: the payout account and business details are refused", async () => {
    h.viewer.role = "provider";
    expect(await saveMerchant(null, form({ email: "someone@business.example.com" }))).toEqual(READ_ONLY);
    expect(await saveBusiness(null, form({ businessName: "Other", category: "software", country: "US", taxId: "12-3456789" }))).toEqual(READ_ONLY);
    expect(h.db).not.toHaveBeenCalled();
  });

  it("P9 mediator: availability is refused with the read-only message", async () => {
    h.viewer.role = "mediator";
    const to = await target(availabilityAction(form({ weeklyHours: "0", paused: "on" })));
    expect(decodeURIComponent((to ?? "").replace(/\+/g, " "))).toContain("Shared demo person: settings are read-only.");
    expect(h.setAvailability).not.toHaveBeenCalled();
  });

  it("P9 declining the terms signs a shared demo person out without a DECLINED record", async () => {
    expect(await target(declineTerms())).toMatch(/^\/login\?error=/);
    expect(h.record).not.toHaveBeenCalled();
    expect(h.end).toHaveBeenCalled();
  });

  it("P9 outside the sandbox the same session is not treated as shared", async () => {
    const { sharedDemo } = await import("@/lib/session");
    const prev = process.env.PAYSETTLE_ENV;
    process.env.PAYSETTLE_ENV = "production";
    try { expect(sharedDemo({ demo: true })).toBe(false); } finally { process.env.PAYSETTLE_ENV = prev; }
    expect(sharedDemo({ demo: true })).toBe(true);
    expect(sharedDemo({ demo: false })).toBe(false);
  });
});
