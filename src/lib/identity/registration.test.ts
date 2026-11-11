/** F1.1 registration form rules (pure): zod fields, password policy, country and time zone lists, terms, honeypot. */
import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, countryName, countryOptions, isCountryCode } from "./countries";
import { errorSummary, HONEYPOT, readRegistration } from "./registration";

const V = "2026-11-08";
const good = { name: "  Nadia   Okoro ", email: " Nadia.Okoro@Example.COM ", password: "Granite-lantern-sky-42", role: "provider", country: "ng", timezone: "Africa/Lagos", terms: "on", termsVersion: V };

describe("F1.1 readRegistration", () => {
  it("F1.1 a complete form is accepted and normalised (trimmed name, lower-case e-mail, upper-case country)", () => {
    const r = readRegistration(good, { termsVersion: V });
    expect(r).toEqual({ ok: true, robot: false, data: { name: "Nadia Okoro", email: "nadia.okoro@example.com", password: "Granite-lantern-sky-42", role: "provider", country: "NG", timezone: "Africa/Lagos" } });
  });

  it("F1.1 each field has its own plain message; the summary lists them in form order", () => {
    const r = readRegistration({ name: "N", email: "not-an-email", password: "short", role: "admin", country: "XX", timezone: "Mars/Olympus", termsVersion: V }, { termsVersion: V });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["country", "email", "name", "password", "role", "terms", "timezone"]);
    expect(r.errors.role?.[0]).toMatch(/client|provider/);
    expect(r.errors.password?.[0]).toMatch(/at least 12 characters/);
    expect(errorSummary(r.errors).map((e) => e.field)).toEqual(["name", "email", "password", "role", "country", "timezone", "terms"]);
  });

  it("F1.1 the platform password policy applies: own name, e-mail name, common passwords, straight runs", () => {
    const pw = (password: string) => { const r = readRegistration({ ...good, password }, { termsVersion: V }); return r.ok ? [] : r.errors.password ?? []; };
    expect(pw("okoro-river-stone-9")).toEqual([expect.stringMatching(/own name/)]);
    expect(pw("nadia.okoro-1234567")).toEqual([expect.stringMatching(/e-mail name/)]);
    expect(pw("password1234")).toEqual([expect.stringMatching(/most used/)]);
    expect(pw("123456789012")).toContainEqual(expect.stringMatching(/most used|straight run/));
    expect(pw("x".repeat(600))).toContainEqual(expect.stringMatching(/too long|at most/));
  });

  it("F1.1 staff roles cannot be chosen; names with links or markup are refused", () => {
    for (const role of ["ops", "admin", "mediator", "finance", "judge", "marketing"]) {
      const r = readRegistration({ ...good, role }, { termsVersion: V });
      expect(r.ok).toBe(false);
    }
    for (const name of ["Visit https://spam.example", "<script>x</script>", "www.cheap.example"]) {
      const r = readRegistration({ ...good, name }, { termsVersion: V });
      expect(!r.ok && r.errors.name?.length).toBeTruthy();
    }
  });

  it("F1.8 the terms box must be ticked, for the version the form showed", () => {
    const off = readRegistration({ ...good, terms: undefined }, { termsVersion: V });
    expect(!off.ok && off.errors.terms?.[0]).toMatch(/Tick the box/);
    const stale = readRegistration({ ...good, termsVersion: "2025-01-01" }, { termsVersion: V });
    expect(!stale.ok && stale.errors.terms?.[0]).toMatch(/terms changed/);
  });

  it("F1.1 honeypot: a filled hidden field reads as a robot whatever else was sent", () => {
    expect(readRegistration({ [HONEYPOT]: "http://spam.example" }, { termsVersion: V })).toEqual({ ok: true, robot: true });
    expect(readRegistration({ ...good, [HONEYPOT]: "  " }, { termsVersion: V }).ok && readRegistration({ ...good, [HONEYPOT]: "  " }, { termsVersion: V })).toMatchObject({ robot: false });
  });

  it("F1.1 an identity-provider e-mail replaces whatever was typed", () => {
    const r = readRegistration({ ...good, email: "typed@evil.example" }, { termsVersion: V, fixedEmail: "Verified@Social.Example" });
    expect(r.ok && !r.robot && r.data.email).toBe("verified@social.example");
  });
});

describe("F1.1 countries", () => {
  it("F1.1 249 ISO 3166-1 codes, no deprecated ones, names from Intl", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    for (const c of ["IN", "US", "GB", "NG", "BR", "AE"]) expect(isCountryCode(c)).toBe(true);
    for (const c of ["UK", "EU", "SU", "YU", "ZZ", "in"]) expect(isCountryCode(c)).toBe(false);
    expect(countryName("IN")).toBe("India");
    const opts = countryOptions();
    expect(opts[0].name.localeCompare(opts[1].name)).toBeLessThanOrEqual(0);
  });
});
