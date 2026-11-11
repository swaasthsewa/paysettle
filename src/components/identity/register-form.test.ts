/** F1.1 registration form markup (server render): every field labelled, hints linked, honeypot out of reach, terms shown. */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RegisterForm } from "./register-form";
import { countryOptions } from "@/lib/identity/countries";
import { HONEYPOT } from "@/lib/identity/registration";

const render = (social: { email: string; name: string } | null = null) => renderToStaticMarkup(createElement(RegisterForm, {
  action: async () => ({ ok: true, message: "" }), termsVersion: "2026-11-08", termsPoints: ["Money is held in PayPal."],
  countries: countryOptions().slice(0, 5), timezones: ["UTC", "Asia/Kolkata"], social,
}));

describe("F1.1 RegisterForm markup", () => {
  it("F1.1 every visible input and select has a label; hints are linked with aria-describedby", () => {
    const html = render();
    const ids = [...html.matchAll(/<(?:input|select)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(7);
    for (const id of ids) expect(html).toContain(`for="${id}"`);
    for (const m of html.matchAll(/aria-describedby="([^"]+)"/g)) for (const ref of m[1].split(" ")) expect(html).toContain(`id="${ref}"`);
    expect(html).toMatch(/name="role" value="client"/);
    expect(html).toMatch(/name="role" value="provider"/);
    expect(html).toMatch(/autocomplete="new-password"/i);
    expect(html).toContain("Platform terms, version 2026-11-08");
    expect(html).toContain('name="termsVersion" value="2026-11-08"');
  });
  it("F1.1 the honeypot is hidden from people and assistive technology and out of the tab order", () => {
    const html = render();
    const hp = html.slice(html.indexOf('class="reg-hp"') - 5, html.indexOf(`name="${HONEYPOT}"`) + 80);
    expect(hp).toContain('aria-hidden="true"');
    expect(hp).toMatch(/tabindex="-1"/i);
  });
  it("F1.1 with a demo identity provider identity the e-mail is fixed and read-only and the form says so", () => {
    const html = render({ email: "verified@social.example", name: "Vera Fide" });
    expect(html).toContain('name="via" value="demo-idp"');
    expect(html).toMatch(/<input[^>]*value="verified@social.example"[^>]*readonly|<input[^>]*readonly[^>]*value="verified@social.example"/i);
    expect(html).not.toMatch(/name="email"/);
    expect(html).toContain('value="Vera Fide"');
  });
});
