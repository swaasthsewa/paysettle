/**
 * F2.05 F2.10 P5 — deadline terms as a contract change: off by default, part of the canonical hash, any change voids
 * signatures, mirrored as clauses (not switchable on their own), R11/R12 in the policy gate, pool split at lock.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { orgs, paypalLinks, revisions, tranches, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { DeadlineTerms } from "@/lib/deadline";
import { DomainError, type Actor } from "../types";
import { applyChange, createWorkspace, getWorkspace, sign } from "./index";

afterAll(async () => { await pool.end(); });

async function people() {
  const tag = newId("t").slice(2, 14);
  const orgId = `org_t_dl_${tag}`;
  await db.insert(orgs).values({ id: orgId, name: `deadline test ${tag}` });
  const c: Actor = { id: `u_c_${tag}`, role: "client" }, p: Actor = { id: `u_p_${tag}`, role: "provider" };
  await db.insert(users).values([
    { id: c.id, orgId, email: `c_${tag}@test.example`, name: "Test Client", role: "client", tier: "standard" },
    { id: p.id, orgId, email: `p_${tag}@test.example`, name: "Test Provider", role: "provider", tier: "platinum" },
  ]);
  await db.insert(paypalLinks).values({ id: `pl_${tag}`, userId: p.id, kind: "merchant", email: `p_${tag}@business.example.com`, receivable: true, emailConfirmed: true });
  return { c, p };
}
const TERMS: DeadlineTerms = { late: { rateBps: 50, graceDays: 1, capBps: 1000, milestones: "ALL" }, early: { poolCents: 12_000, rateBps: 25, minDaysEarly: 2, capBps: 100, milestones: "ALL" } };

describe("F2.05 F2.10 deadline terms in the contract", () => {
  it("off by default; switching on is a new revision that voids signatures and changes the hash", async () => {
    const { c, p } = await people();
    const id = await createWorkspace(c, { blueprintCode: "UC_WEB_MVP", title: "Deadline terms test", totalCents: 600_000, providerId: p.id });
    let v = await getWorkspace(c, id);
    expect(v.deadline).toBeNull();
    v = await sign(c, id, v.revision, v.canonicalHash!);
    const before = v.canonicalHash;
    v = await applyChange(p, id, { action: "SET_DEADLINE_TERMS", terms: TERMS });
    expect(v.revision).toBe(2);
    expect(v.canonicalHash).not.toBe(before);
    expect(v.signatures.every((s) => s.voided)).toBe(true);
    expect(v.deadline).toEqual(TERMS);
    const [rev] = await db.select().from(revisions).where(and(eq(revisions.workspaceId, id), eq(revisions.revNo, 2)));
    expect((rev.canonical as { deadline?: unknown }).deadline).toEqual(TERMS);
    const cl = v.clauses.filter((k) => k.code === "LATE_DEDUCTION" || k.code === "EARLY_BONUS");
    expect(cl.map((k) => [k.code, k.active])).toEqual([["EARLY_BONUS", true], ["LATE_DEDUCTION", true]]);
    expect(cl.find((k) => k.code === "EARLY_BONUS")?.body).toContain("$120.00");
    await expect(applyChange(c, id, { action: "TOGGLE_CLAUSE", clauseCode: "LATE_DEDUCTION", active: false })).rejects.toMatchObject({ code: "DEADLINE_TERMS" });
    await expect(applyChange(c, id, { action: "SET_DEADLINE_TERMS", terms: TERMS })).rejects.toMatchObject({ code: "NO_CHANGE" });
    v = await applyChange(c, id, { action: "SET_DEADLINE_TERMS", terms: null });
    expect(v.deadline).toBeNull();
    expect(v.clauses.filter((k) => k.code === "LATE_DEDUCTION" || k.code === "EARLY_BONUS").every((k) => !k.active)).toBe(true);
  });

  it("R11/R12 block signing until fixed; lock funds the pool with the tranche", async () => {
    const { c, p } = await people();
    const id = await createWorkspace(c, { blueprintCode: "UC_WEB_MVP", title: "Deadline policy test", totalCents: 600_000, providerId: p.id });
    let v = await applyChange(c, id, { action: "SET_DEADLINE_TERMS", terms: { ...TERMS, late: { ...TERMS.late!, capBps: 2500 } } });
    expect(v.violations.map((x) => x.code)).toContain("LATE_CAP_TOO_HIGH");
    expect(v.state).toBe("DRAFT");
    await expect(sign(c, id, v.revision, v.canonicalHash!)).rejects.toBeInstanceOf(DomainError);
    v = await applyChange(c, id, { action: "SET_DEADLINE_TERMS", terms: TERMS });
    expect(v.violations).toEqual([]);
    v = await sign(c, id, v.revision, v.canonicalHash!);
    v = await sign(p, id, v.revision, v.canonicalHash!);
    expect(v.state).toBe("LOCKED");
    const ts = await db.select().from(tranches).where(eq(tranches.workspaceId, id));
    expect(ts.reduce((s, t) => s + t.bonusPoolCents, 0)).toBe(12_000);
    expect(v.bonusPools?.[ts[0].id]).toBe(ts[0].bonusPoolCents);
  });
});
