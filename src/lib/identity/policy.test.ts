// F1.1, F1.2 · tests: the password policy (12+ characters, no e-mail name or own name, no common passwords).
import { describe, expect, it } from "vitest";
import { passwordAcceptable, passwordProblems, personalParts, PASSWORD_MIN } from "./policy";

const ctx = { email: "arjun.rao@provider.demo", name: "Arjun Rao" };

describe("F1.1 password policy", () => {
  it("F1.1 refuses fewer than 12 characters and says how many there are", () => {
    expect(PASSWORD_MIN).toBe(12);
    expect(passwordProblems("short-pw-1", ctx)[0]).toMatch(/at least 12 characters \(this one has 10\)/);
    expect(passwordAcceptable("tidal-lamp-orbit-9", ctx)).toBe(true);
  });
  it("F1.1 refuses a password that contains the e-mail name or a part of it, in any case", () => {
    expect(personalParts(ctx)).toEqual(expect.arrayContaining(["arjun.rao", "arjun", "rao"]));
    expect(passwordAcceptable("my-ARJUN.RAO-secret", ctx)).toBe(false);
    expect(passwordAcceptable("hello-arjun-2026x", ctx)).toBe(false);
    expect(passwordProblems("hello-arjun-2026x", ctx)).toContain("Leave your e-mail name and your own name out of the password.");
  });
  it("F1.1 refuses common passwords, repeats and straight runs", () => {
    expect(passwordAcceptable("Password1234", {})).toBe(false);
    expect(passwordAcceptable("zzzzzzzzzzzzzz", {})).toBe(false);
    expect(passwordAcceptable("abcdefghijklm", {})).toBe(false);
  });
  it("F1.1 refuses passwords longer than 128 characters", () => {
    expect(passwordAcceptable("x".repeat(64) + "y".repeat(65), {})).toBe(false);
  });
});
