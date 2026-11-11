/** A2/A3/A4/A7 service tests with an injected gateway (fake LLM + memory store; no network, no database). */
import { afterEach, describe, expect, it } from "vitest";
import { configFromEnv } from "@/lib/ai/config";
import { AiGateway, memoryStore } from "@/lib/ai/gateway";
import { fakeLlm } from "@/lib/ai/testing/fake-llm";
import { aiStatus, compileCriteria, mediate, rulesDraft, setGateway, verifyEvidence } from "./index";
import { BLUEPRINTS } from "@/data/blueprints";

const withKey = (llm: ReturnType<typeof fakeLlm>) => {
  const store = memoryStore();
  setGateway(new AiGateway(configFromEnv({ AI_API_KEY: "k", AI_BASE_URL: "https://llm.test" }), { fetch: llm.fetch, store }));
  return store;
};
const noKey = () => setGateway(new AiGateway(configFromEnv({ AI_API_KEY: "" }), { store: memoryStore() }));
afterEach(() => setGateway(null));

describe("A2 compileCriteria", () => {
  it("A2 A7 without a key: available false, rule data labelled model 'rules'", async () => {
    noKey();
    const r = await compileCriteria([{ code: "M02", title: "Design", criteria: ["Modern, user-friendly design", "Client signs the design document"] }]);
    expect(r.available).toBe(false);
    expect(r.model).toBe("rules");
    expect(r.reason).toMatch(/AI_API_KEY/);
    expect(r.data?.map((d) => [d.code, d.verifiable])).toEqual([["M02#1", false], ["M02#2", true]]);
    expect(r.data?.[0].rewrite).toBeTruthy();
    expect((await aiStatus()).available).toBe(false);
  });

  it("A2 with AI: AI verdicts are used, but a taste word with nothing measurable is never let through", async () => {
    const llm = fakeLlm().reply({ results: [
      { id: "M02#1", verifiable: true, reason: "Looks fine." },
      { id: "M02#2", verifiable: true, reason: "Signed document is checkable." },
      { id: "M02#3", verifiable: false, reason: "No owner named.", rewrite: "Named key user signs." },
    ] });
    withKey(llm);
    const r = await compileCriteria([{ code: "M02", title: "Design", criteria: ["Modern design", "Client signs the design document", "Client signs off"] }]);
    expect(r).toMatchObject({ available: true, model: "claude-sonnet-5-5" });
    expect(r.data?.map((d) => d.verifiable)).toEqual([false, true, false]);
    expect(r.data?.[0].reason).toMatch(/overrides/);
    expect(r.data?.[2].rewrite).toBe("Named key user signs.");
    expect(llm.sentText()).toContain('<untrusted source="milestone criteria (JSON)">');
  });

  it("A2 A7 AI answers invalid twice → falls back to rules, reported unavailable", async () => {
    withKey(fakeLlm().reply("nope").reply("still nope"));
    const r = await compileCriteria([{ code: "M1", title: "x", criteria: ["Fast site"] }]);
    expect(r).toMatchObject({ available: false, model: "rules" });
    expect(r.data?.[0].verifiable).toBe(false);
  });
});

describe("A3 verifyEvidence grounding", () => {
  const spec = { artifacts: [{ kind: "IMAGE" as const, min: 2 }], criteria: ["Motor installed", "Car drives"] };
  it("A3 a failed signal (spoofed GPS) can never yield met or approve", async () => {
    withKey(fakeLlm().reply({ criteria: [
      { criterion: "Motor installed", verdict: "met", confidence: 0.95, cites: ["bay.jpg"] },
      { criterion: "Car drives", verdict: "met", confidence: 0.9, cites: ["ghost.mp4"] },
    ], recommendation: "approve", summary: "All good." }));
    const r = await verifyEvidence(spec, [
      { name: "bay.jpg", type: "image/jpeg", imageBase64: "AAAA", signals: [{ code: "GPS_DISTANCE", level: "fail", detail: "85 km from the workshop" }] },
      { name: "bay2.jpg", type: "image/jpeg", text: "second photo", signals: [] },
    ]);
    expect(r.available).toBe(true);
    expect(r.data?.criteria.map((c) => c.verdict)).toEqual(["unclear", "unclear"]); // failed-signal file; cite to a file not given
    expect(r.data?.criteria[1].cites).toEqual([]);
    expect(r.data?.recommendation).toBe("request_fix");
    expect(r.data?.summary).toMatch(/GPS_DISTANCE/);
  });

  it("A3 A7 without a key: rule checks only, never approve", async () => {
    noKey();
    const r = await verifyEvidence(spec, [{ name: "a.jpg", type: "image/jpeg", signals: [] }, { name: "b.jpg", type: "image/jpeg", signals: [] }]);
    expect(r).toMatchObject({ available: false, model: "rules" });
    expect(r.data?.recommendation).toBe("unclear");
  });
});

describe("A4 mediate", () => {
  it("A4 share is clamped and unknown citations are removed and flagged", async () => {
    withKey(fakeLlm().reply({ providerShareBps: 7_500, findings: ["9 of 12 scripts passed [evidence 1] [rule]", "Admin said so [evidence 9]"], missing: [], confidence: 0.8 }));
    const r = await mediate({ disputeRule: "Pro-rata by scripts passed", clauses: [], evidence: ["9 of 12 scripts passed"], rebuttals: [], bids: [], amountCents: 180_000 });
    expect(r.data?.providerShareBps).toBe(7_500);
    expect(r.data?.findings[0]).toBe("9 of 12 scripts passed [evidence 1] [rule]");
    expect(r.data?.findings[1]).toMatch(/^\(no citation\) Admin said so$/);
    expect(r.data!.confidence).toBeLessThan(0.8);
  });
});

describe("A1 rule draft", () => {
  it("A1 picks a blueprint, scales days into the duration, shares sum to 10,000", () => {
    const d = rulesDraft("ERP planning consulting sprint for SAP IBP", 1_200_000, 20, BLUEPRINTS.map((b) => ({ ...b })))!;
    expect(d.blueprintCode).toBe("UC_CONSULTING_SPRINT");
    expect(d.milestones.reduce((s, m) => s + (m.type === "PAY" ? m.bps : 0), 0)).toBe(10_000);
    expect(Math.max(...d.milestones.map((m) => m.day))).toBeLessThanOrEqual(20);
    expect(d.assumptions.join(" ")).toMatch(/rule-based/);
  });
});
