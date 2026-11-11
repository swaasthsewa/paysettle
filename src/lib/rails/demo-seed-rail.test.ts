/**
 * F3.01 P9 — demo seeds always use the mock rail. With PayPal Sandbox credentials set, seed-link used to create a real
 * PayPal order and then fail with ORDER_NOT_APPROVED. scripts/lib/demo-rail.ts blanks the credentials for seed processes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { demoSeedEnv, forceMockRail, PAYPAL_ENV_KEYS } from "../../../scripts/lib/demo-rail";
import { liveAvailable, railFor } from "./index";

const saved = { ...process.env };
afterEach(() => { for (const k of PAYPAL_ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe("demo seeds run on the mock rail", () => {
  it("blanks PayPal credentials so the rail is the mock even when Sandbox credentials are set", () => {
    process.env.PAYPAL_CLIENT_ID = "sandbox-id"; process.env.PAYPAL_CLIENT_SECRET = "sandbox-secret"; process.env.PAYPAL_RAIL = "A1";
    expect(liveAvailable()).toBe(true);
    forceMockRail();
    expect(liveAvailable()).toBe(false);
    expect(railFor("A1").id).toBe("MOCK");
  });

  it("child seed processes get blank (not missing) credentials, so --env-file cannot load them again", () => {
    const env = demoSeedEnv({ PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y", DATABASE_URL: "postgres://db" });
    expect(env.PAYPAL_CLIENT_ID).toBe("");
    expect(env.PAYPAL_CLIENT_SECRET).toBe("");
    expect(env.DATABASE_URL).toBe("postgres://db");
  });

  it("every seed script imports the guard before anything else", () => {
    const dir = join(process.cwd(), "scripts");
    const seeds = readdirSync(dir).filter((f) => /^seed.*\.ts$/.test(f));
    expect(seeds.length).toBeGreaterThan(5);
    for (const f of seeds) {
      const firstImport = readFileSync(join(dir, f), "utf8").split("\n").find((l) => l.startsWith("import "));
      expect(firstImport, f).toContain("./lib/demo-rail");
    }
  });
});
