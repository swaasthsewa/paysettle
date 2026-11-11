/** A5 · MCP JSON-RPC server: initialize, tools/list, tools/call round trips with stubbed module services and human gates. */
import { describe, expect, it, vi } from "vitest";
import { handleMcp, toolList, type McpContext, type McpServices } from "./mcp";
import { NotBuilt, type WorkspaceView } from "../types";

const ws = (over: Partial<WorkspaceView> = {}): WorkspaceView => ({
  id: "ws_1", title: "ERP sprint", blueprintCode: "UC_CONSULTING_SPRINT", state: "LOCKED", revision: 3, rail: "MOCK", currency: "USD",
  totalCents: 1_200_000, feeBps: 250, riskScore: 40, canonicalHash: "h", client: { id: "u_dan", name: "Dan Okafor" }, provider: { id: "u_arjun", name: "Arjun Rao" }, inviteEmail: null,
  milestones: [{ id: "ms_2", seq: 2, code: "M02", title: "Assessment", type: "PAY", origin: "BASELINE", active: true, targetDay: 5, bps: 1000, amountCents: 120_000, proof: { artifacts: [], criteria: [] }, lockRule: "", disputeRule: "", dependsOn: [], trancheIdx: 1, state: "SUBMITTED", attempts: 0, reviewDueAt: null }],
  clauses: [], signatures: [{ role: "client", signerId: "u_dan", revNo: 3, voided: false, at: new Date() }],
  tranches: [{ id: "tr_1", idx: 1, rail: "MOCK", amountCents: 1_200_000, startDay: 1, endDay: 24, state: "PLANNED", approveUrl: null, heldAt: null, windowEndsAt: null }],
  violations: [], ...over,
});

function services(over: Partial<McpServices> = {}) {
  const s: McpServices = {
    searchBlueprints: vi.fn(async () => [{ code: "UC_CONSULTING_SPRINT", title: "Consulting", vertical: "ERP", kind: "DIGITAL", recommendedDays: 24, summary: "s", milestones: 9, score: 6 }]),
    draftContract: vi.fn(async () => ({ available: false, reason: "No AI key", model: "rules", data: { blueprintCode: "UC_CONSULTING_SPRINT", title: "ERP sprint", milestones: [{ title: "Kickoff", type: "GATE" as const, day: 2, bps: 0, proof: { artifacts: [], criteria: ["x"] }, lockRule: "a", disputeRule: "b" }], assumptions: ["a"] } })),
    createWorkspace: vi.fn(async () => "ws_new"),
    applyChange: vi.fn(async () => ws({ state: "DRAFT", revision: 4 })),
    getWorkspace: vi.fn(async () => ws()),
    fundTranche: vi.fn(async () => ({ approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=EC-1" })),
    submitEvidence: vi.fn(async () => ({ packageId: "ep_1", rootHash: "r", signals: [] })),
    openDispute: vi.fn(async () => "dp_1"),
    reserveSpend: vi.fn(async () => true),
    releaseSpend: vi.fn(async () => undefined),
    createApproval: vi.fn(async () => ({ id: "apr_1", state: "PENDING", createdAt: new Date(), reused: false })),
    audit: vi.fn(async () => undefined),
    ...over,
  };
  return s;
}
const ctx = (role: McpContext["actor"]["role"] = "client"): McpContext => ({ actor: { id: "u_dan", role }, tokenId: "agt_1", spendLimitCents: 1_500_000, spentCents: 0, appUrl: "http://app.test" });
const call = (name: string, args: unknown, id = 7) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
type R = { result: { isError: boolean; structuredContent: Record<string, unknown>; content: { text: string }[] } };

describe("A5 MCP protocol", () => {
  it("A5 initialize negotiates the protocol version and announces tools", async () => {
    const r = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, ctx(), services());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "paysettle" } } });
    const unknownVersion = await handleMcp({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, ctx(), services());
    expect((unknownVersion.body as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-06-18");
  });

  it("A5 notifications get 202 with no body; unknown methods get -32601; bad envelopes -32600", async () => {
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx(), services())).toEqual({ status: 202, body: null });
    expect(((await handleMcp({ jsonrpc: "2.0", id: 3, method: "resources/list" }, ctx(), services())).body as { error: { code: number } }).error.code).toBe(-32601);
    expect(((await handleMcp({ id: 3, method: "ping" }, ctx(), services())).body as { error: { code: number } }).error.code).toBe(-32600);
    const batch = await handleMcp([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }], ctx(), services());
    expect(batch.body).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
  });

  it("A5 tools/list exposes the eight PRD tools with closed JSON Schemas", async () => {
    const r = await handleMcp({ jsonrpc: "2.0", id: 4, method: "tools/list" }, ctx(), services());
    const tools = (r.body as { result: { tools: { name: string; inputSchema: { type: string; additionalProperties?: boolean } }[] } }).result.tools;
    expect(tools.map((t) => t.name)).toEqual(["search_blueprints", "draft_contract", "propose_changes", "get_contract_status", "request_funding", "submit_evidence", "approve_release", "open_dispute"]);
    for (const t of tools) { expect(t.inputSchema.type).toBe("object"); expect(t.inputSchema.additionalProperties).toBe(false); }
    expect(toolList().find((t) => t.name === "approve_release")?.description).toMatch(/moves no money/);
  });

  it("A5 unknown tool → -32602; invalid arguments → tool error result", async () => {
    const u = await handleMcp(call("delete_everything", {}), ctx(), services());
    expect((u.body as { error: { code: number } }).error.code).toBe(-32602);
    const bad = (await handleMcp(call("draft_contract", { brief: "short", budgetCents: -1, days: 0, extra: true }), ctx(), services())).body as R;
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toMatch(/Invalid arguments/);
  });
});

describe("A5 MCP tools round trip (stubbed module services)", () => {
  it("A5 search_blueprints → results", async () => {
    const svc = services();
    const r = (await handleMcp(call("search_blueprints", { query: "ERP planning", maxDays: 30 }), ctx(), svc)).body as R;
    expect(r.result.isError).toBe(false);
    expect(r.result.structuredContent.results).toHaveLength(1);
    expect(svc.searchBlueprints).toHaveBeenCalledWith({ query: "ERP planning", maxDays: 30 });
    expect(JSON.parse(r.result.content[0].text)).toEqual(r.result.structuredContent);
  });

  it("A5 draft_contract creates a workspace as the token's person, labelled rules when AI is off", async () => {
    const svc = services();
    const r = (await handleMcp(call("draft_contract", { brief: "SAP IBP planning sprint for our plants", budgetCents: 1_200_000, days: 24, providerEmail: "arjun@provider.demo" }), ctx(), svc)).body as R;
    expect(r.result.structuredContent).toMatchObject({ contractId: "ws_new", state: "DRAFT", link: "http://app.test/contracts/ws_new" });
    expect(String(r.result.structuredContent.drafter)).toMatch(/^rules/);
    expect(svc.createWorkspace).toHaveBeenCalledWith({ id: "u_dan", role: "client" }, expect.objectContaining({ blueprintCode: "UC_CONSULTING_SPRINT", totalCents: 1_200_000, inviteEmail: "arjun@provider.demo" }));
    expect(svc.audit).toHaveBeenCalledWith(expect.anything(), "ai.mcp.draft_contract", "ws_new", expect.anything());
  });

  it("A5 request_funding returns the PayPal approval URL for the human and reserves spend", async () => {
    const svc = services();
    const r = (await handleMcp(call("request_funding", { contractId: "ws_1" }), ctx(), svc)).body as R;
    expect(r.result.isError).toBe(false);
    expect(r.result.structuredContent).toMatchObject({ trancheId: "tr_1", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=EC-1", amount: "$12,000.00" });
    expect(String(r.result.structuredContent.humanAction)).toMatch(/approve/);
    expect(svc.reserveSpend).toHaveBeenCalledWith("agt_1", 1_200_000);
  });

  it("A5 request_funding refuses past the token's spend limit and creates no order", async () => {
    const svc = services({ reserveSpend: vi.fn(async () => false) });
    const r = (await handleMcp(call("request_funding", { contractId: "ws_1" }), { ...ctx(), spendLimitCents: 500_000 }, svc)).body as R;
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/SPEND_LIMIT.*\$5,000\.00/);
    expect(svc.fundTranche).not.toHaveBeenCalled();
  });

  it("A5 request_funding gives the reserved spend back when the money module fails", async () => {
    const svc = services({ fundTranche: vi.fn(async () => { throw new NotBuilt("fundTranche"); }) });
    const r = (await handleMcp(call("request_funding", { contractId: "ws_1" }), ctx(), svc)).body as R;
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/NOT_BUILT: fundTranche is not built yet/);
    expect(svc.releaseSpend).toHaveBeenCalledWith("agt_1", 1_200_000);
  });

  it("P3 P4 A5 approve_release never releases: it records a pending approval and links the human to the app", async () => {
    const svc = services();
    const r = (await handleMcp(call("approve_release", { contractId: "ws_1", milestoneId: "ms_2" }), ctx(), svc)).body as R;
    expect(r.result.structuredContent).toMatchObject({ approvalId: "apr_1", state: "PENDING", released: false, confirmUrl: "http://app.test/contracts/ws_1/m/ms_2" });
    expect(svc.createApproval).toHaveBeenCalledTimes(1);
    expect(svc.fundTranche).not.toHaveBeenCalled();
  });

  it("A5 permissions follow the person's role (a provider cannot request funding or approve)", async () => {
    const svc = services();
    for (const [name, args] of [["request_funding", { contractId: "ws_1" }], ["approve_release", { contractId: "ws_1", milestoneId: "ms_2" }]] as const) {
      const r = (await handleMcp(call(name, args), ctx("provider"), svc)).body as R;
      expect(r.result.isError).toBe(true);
      expect(r.result.content[0].text).toMatch(/PERMISSION_DENIED/);
    }
    expect(svc.createApproval).not.toHaveBeenCalled();
    const ok = (await handleMcp(call("submit_evidence", { contractId: "ws_1", milestoneId: "ms_2", note: "Report attached", urls: ["https://example.com/report.pdf"] }), ctx("provider"), svc)).body as R;
    expect(ok.result.isError).toBe(false);
    const files = (svc.submitEvidence as ReturnType<typeof vi.fn>).mock.calls[0][2] as { name: string; type: string; bytes: Buffer }[];
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: "link-1.url", type: "text/uri-list" });
  });

  it("A5 get_contract_status, propose_changes and open_dispute go through the module exports", async () => {
    const svc = services();
    const st = (await handleMcp(call("get_contract_status", { contractId: "ws_1" }), ctx(), svc)).body as R;
    expect(st.result.structuredContent).toMatchObject({ id: "ws_1", state: "LOCKED", total: "$12,000.00" });
    const pc = (await handleMcp(call("propose_changes", { contractId: "ws_1", changes: [{ action: "PRUNE", milestoneCode: "M04" }, { action: "SET_DAY", milestoneCode: "M05", day: 15 }] }), ctx(), svc)).body as R;
    expect(pc.result.structuredContent).toMatchObject({ applied: 2, revision: 4 });
    expect(svc.applyChange).toHaveBeenCalledTimes(2);
    const od = (await handleMcp(call("open_dispute", { milestoneId: "ms_2", reason: "Missing sections", narrative: "Sections 4 and 5 are missing from the report." }), ctx(), svc)).body as R;
    expect(od.result.structuredContent).toMatchObject({ disputeId: "dp_1" });
  });
});
