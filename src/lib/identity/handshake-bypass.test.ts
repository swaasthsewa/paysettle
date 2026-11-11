/**
 * F1.9 sandbox bypass, end to end through the login server action: with PAYSETTLE_ENV=production the persona picker
 * action refuses before touching the database or starting any session. F1.8: in the sandbox it hands over to the handshake.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ begin: vi.fn(), end: vi.fn(), select: vi.fn(), audit: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); } }));
vi.mock("@/lib/session", () => ({ endSession: h.end, startSession: vi.fn(), homeFor: () => "/ops" }));
vi.mock("@/lib/identity/handshake-session", () => ({ beginSignIn: h.begin }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/db/client", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: h.select }) }) }) } }));

import { demoSignIn } from "@/app/(auth)/login/actions";

const form = (userId: string) => { const f = new FormData(); f.set("userId", userId); return f; };
const target = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as { to?: string }).to ?? String(e); } };
afterEach(() => { vi.clearAllMocks(); });

describe("F1.9 persona picker action", () => {
  it("F1.9 refuses demo sign-in when PAYSETTLE_ENV=production, with no lookup and no session", async () => {
    const prev = process.env.PAYSETTLE_ENV;
    process.env.PAYSETTLE_ENV = "production";
    try {
      const to = await target(demoSignIn(form("u_ops")));
      expect(to).toMatch(/^\/login\?error=/);
      expect(decodeURIComponent(to!)).toContain("off in production");
      expect(h.select).not.toHaveBeenCalled();
      expect(h.begin).not.toHaveBeenCalled();
      expect(h.end).not.toHaveBeenCalled();
    } finally { process.env.PAYSETTLE_ENV = prev; }
  });
  it("F1.9 F1.8 in the sandbox a persona goes through the terms handshake", async () => {
    h.select.mockResolvedValue([{ id: "u_ops", role: "ops", persona: "5-ops" }]);
    h.begin.mockResolvedValue("/terms-accept");
    expect(await target(demoSignIn(form("u_ops")))).toBe("/terms-accept");
    expect(h.begin).toHaveBeenCalledWith(expect.objectContaining({ id: "u_ops" }), { mfa: true, demo: true, via: "demo" });
  });
  it("F1.9 a user without a persona is refused even in the sandbox", async () => {
    h.select.mockResolvedValue([{ id: "u_noor", role: "provider", persona: null }]);
    expect(decodeURIComponent((await target(demoSignIn(form("u_noor"))))!)).toContain("Unknown person");
    expect(h.begin).not.toHaveBeenCalled();
  });
});
