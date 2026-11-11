/**
 * A5 · MCP server, transport-agnostic core: JSON-RPC 2.0 over Streamable HTTP (POST only, JSON
 * responses, no SSE). Methods: initialize, notifications/*, ping, tools/list, tools/call.
 *
 * Design ported from the reference assistant tools: each tool has a closed input schema (zod → JSON Schema), a
 * permission check with the same can() the screens use, and runs as the token's person (never more than they may do).
 * Human gates:
 *   request_funding → returns the PayPal approval URL; nothing is held until the buyer approves in PayPal.
 *                     Reserved against the token's spend limit (cents) before the order is created.
 *   approve_release → NEVER releases: records a pending request the client confirms in the app (MFA). (P3, P4)
 * Tools reach other modules only through src/server/<module>/index.ts (injected as McpServices so tests can stub them).
 * A module that is not built yet surfaces as a clear tool error (isError: true), not a protocol failure.
 */
import { z } from "zod";
import { can, type Permission } from "@/lib/rbac";
import { formatCents } from "@/lib/money";
import { proofSchema } from "@/lib/ai/schemas";
import { DomainError, NotBuilt, type Actor, type Change, type WorkspaceView } from "../types";
import type { AiResult } from "./index";
import type { DraftMilestone } from "@/lib/ai/rules";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const SERVER_INFO = { name: "paysettle", title: "PaySettle milestone contracts", version: "0.1.0" };

export interface McpContext { actor: Actor; tokenId: string; spendLimitCents: number; spentCents: number; appUrl: string }
export interface McpServices {
  searchBlueprints(q: { query?: string; vertical?: string; maxDays?: number }): Promise<{ code: string; title: string; vertical: string; kind: string; recommendedDays: number; summary: string; milestones: number; score: number }[]>;
  draftContract(brief: string, budgetCents: number, days: number): Promise<AiResult<{ blueprintCode: string; title: string; milestones: DraftMilestone[]; assumptions: string[] }>>;
  createWorkspace(a: Actor, i: { blueprintCode: string; title: string; totalCents: number; providerId?: string; inviteEmail?: string; draft?: unknown }): Promise<string>;
  applyChange(a: Actor, id: string, c: Change): Promise<WorkspaceView>;
  getWorkspace(a: Actor, id: string): Promise<WorkspaceView>;
  fundTranche(a: Actor, trancheId: string): Promise<{ approveUrl: string }>;
  submitEvidence(a: Actor, milestoneId: string, files: { name: string; type: string; bytes: Buffer; exif?: Record<string, unknown> }[], note: string): Promise<{ packageId: string; rootHash: string; signals: { code: string; level: "ok" | "warn" | "fail"; detail: string }[] }>;
  openDispute(a: Actor, milestoneId: string, reason: string, narrative: string): Promise<string>;
  reserveSpend(tokenId: string, cents: number): Promise<boolean>;
  releaseSpend(tokenId: string, cents: number): Promise<void>;
  createApproval(a: Actor, p: { tokenId: string; workspaceId: string; milestoneId: string; note: string; detail?: Record<string, unknown> }): Promise<{ id: string; state: string; createdAt: Date; reused: boolean }>;
  audit(a: Actor, action: string, target: string, detail: Record<string, unknown>): Promise<void>;
}

class ToolError extends Error { constructor(readonly code: string, message: string) { super(message); } }
const need = (a: Actor, p: Permission) => { if (!can(a.role, p)) throw new ToolError("PERMISSION_DENIED", `Your role (${a.role}) may not ${p.replace(".", " ")}.`); };
const id = z.string().min(1).max(80);

const changeSchema = z.union([
  z.object({ action: z.literal("PRUNE"), milestoneCode: id }).strict(),
  z.object({ action: z.literal("RESTORE"), milestoneCode: id }).strict(),
  z.object({ action: z.literal("APPEND"), milestone: z.object({ title: z.string().min(3).max(160), type: z.enum(["GATE", "PAY"]), day: z.number().int().min(1).max(365), bps: z.number().int().min(0).max(10_000), proof: proofSchema, lockRule: z.string().min(3).max(300), disputeRule: z.string().min(3).max(300), afterCode: id.optional() }).strict() }).strict(),
  z.object({ action: z.literal("SET_BPS"), shares: z.record(z.string(), z.number().int().min(0).max(10_000)) }).strict(),
  z.object({ action: z.literal("SET_DAY"), milestoneCode: id, day: z.number().int().min(1).max(365) }).strict(),
  z.object({ action: z.literal("TOGGLE_CLAUSE"), clauseCode: id, active: z.boolean() }).strict(),
  z.object({ action: z.literal("APPEND_CLAUSE"), title: z.string().min(3).max(120), body: z.string().min(3).max(2_000), linkedMilestone: id.optional() }).strict(),
  z.object({ action: z.literal("SET_TOTAL"), totalCents: z.number().int().min(1_000).max(100_000_000) }).strict(),
]);

interface ToolDef<S extends z.ZodType> {
  name: string; title: string; description: string; input: S;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run(args: z.infer<S>, ctx: McpContext, svc: McpServices): Promise<Record<string, unknown>>;
}
const tool = <S extends z.ZodType>(t: ToolDef<S>) => t;

function statusView(w: WorkspaceView) {
  return {
    id: w.id, title: w.title, state: w.state, revision: w.revision, rail: w.rail, currency: w.currency, total: formatCents(w.totalCents, w.currency), totalCents: w.totalCents,
    client: w.client.name, provider: w.provider?.name ?? null, riskScore: w.riskScore,
    milestones: w.milestones.filter((m) => m.active).map((m) => ({ id: m.id, code: m.code, title: m.title, type: m.type, state: m.state, day: m.targetDay, share: `${m.bps / 100}%`, amount: formatCents(m.amountCents, w.currency), tranche: m.trancheIdx })),
    tranches: w.tranches.map((t) => ({ id: t.id, idx: t.idx, state: t.state, amount: formatCents(t.amountCents, w.currency), amountCents: t.amountCents, days: `${t.startDay}–${t.endDay}`, approveUrl: t.approveUrl })),
    signatures: w.signatures.filter((s) => !s.voided).map((s) => ({ role: s.role, revision: s.revNo })),
    violations: w.violations,
  };
}

export const TOOLS = [
  tool({
    name: "search_blueprints", title: "Search blueprints",
    description: "Find vetted contract templates (blueprints) by free text, vertical and maximum duration. Read-only.",
    input: z.object({ query: z.string().max(300).optional(), vertical: z.string().max(80).optional(), maxDays: z.number().int().min(1).max(365).optional() }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, _ctx, svc) { return { results: await svc.searchBlueprints(a) }; },
  }),
  tool({
    name: "draft_contract", title: "Draft a contract workspace",
    description: "Create a negotiation workspace (a draft, not a contract) from a brief, budget and duration. Uses the AI drafter when available, else rule-based blueprint matching. Nothing is signed or funded; both parties still negotiate and sign in the app.",
    input: z.object({ brief: z.string().min(10).max(4_000), budgetCents: z.number().int().min(1_000).max(100_000_000), days: z.number().int().min(1).max(365), providerEmail: z.email().optional(), providerId: id.optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(a, ctx, svc) {
      need(ctx.actor, "contract.create");
      const d = await svc.draftContract(a.brief, a.budgetCents, a.days);
      if (!d.data) throw new ToolError("NO_DRAFT", d.reason ?? "No draft could be made.");
      const wid = await svc.createWorkspace(ctx.actor, { blueprintCode: d.data.blueprintCode, title: d.data.title, totalCents: a.budgetCents, providerId: a.providerId, inviteEmail: a.providerEmail, draft: d.data });
      await svc.audit(ctx.actor, "ai.mcp.draft_contract", wid, { tokenId: ctx.tokenId, blueprintCode: d.data.blueprintCode, ai: d.available });
      return {
        contractId: wid, state: "DRAFT", blueprintCode: d.data.blueprintCode, title: d.data.title, total: formatCents(a.budgetCents),
        drafter: d.available ? `AI (${d.model})` : `rules (AI unavailable: ${d.reason ?? "unknown"})`,
        milestones: d.data.milestones.map((m) => ({ title: m.title, type: m.type, day: m.day, share: `${m.bps / 100}%` })), assumptions: d.data.assumptions,
        link: `${ctx.appUrl}/contracts/${wid}`, next: "Both parties review and sign in the app. Funding is possible only after signing.",
      };
    },
  }),
  tool({
    name: "propose_changes", title: "Propose changes to a workspace",
    description: "Apply prune/restore/append and share, day, clause or total changes to a negotiation workspace. Each change makes a new revision; the counterparty sees the diff and any earlier signature is voided.",
    input: z.object({ contractId: id, changes: z.array(changeSchema).min(1).max(10) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(a, ctx, svc) {
      need(ctx.actor, "contract.negotiate");
      let view: WorkspaceView | null = null;
      for (const c of a.changes) view = await svc.applyChange(ctx.actor, a.contractId, c as Change);
      await svc.audit(ctx.actor, "ai.mcp.propose_changes", a.contractId, { tokenId: ctx.tokenId, changes: a.changes.length });
      return { applied: a.changes.length, revision: view?.revision, state: view?.state, violations: view?.violations ?? [], link: `${ctx.appUrl}/contracts/${a.contractId}` };
    },
  }),
  tool({
    name: "get_contract_status", title: "Get contract status",
    description: "Read a contract's state, revision, tranches (with PayPal approval links when waiting), milestones and policy violations. Read-only.",
    input: z.object({ contractId: id }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, ctx, svc) { return statusView(await svc.getWorkspace(ctx.actor, a.contractId)); },
  }),
  tool({
    name: "request_funding", title: "Request funding of a tranche",
    description: "Create the PayPal order for one tranche of a signed contract and return the approval URL. HUMAN GATE: the buyer must open the URL and approve in PayPal; nothing is held until then. Limited by this token's spend limit.",
    input: z.object({ contractId: id, trancheIdx: z.number().int().min(1).max(50).optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run(a, ctx, svc) {
      need(ctx.actor, "hold.fund");
      const w = await svc.getWorkspace(ctx.actor, a.contractId);
      const t = a.trancheIdx ? w.tranches.find((x) => x.idx === a.trancheIdx) : w.tranches.find((x) => x.state === "PLANNED" || x.state === "AWAITING_APPROVAL");
      if (!t) throw new ToolError("NO_TRANCHE", w.tranches.length ? "No tranche is waiting for funding." : "The contract has no tranches yet; both parties must sign first.");
      if (t.state === "AWAITING_APPROVAL" && t.approveUrl) return { trancheId: t.id, amount: formatCents(t.amountCents, w.currency), approveUrl: t.approveUrl, humanAction: "Already requested. The buyer approves this hold in PayPal; nothing is held until then." };
      if (t.state !== "PLANNED") throw new ToolError("TRANCHE_STATE", `Tranche ${t.idx} is ${t.state}; only a planned tranche can be funded.`);
      if (!(await svc.reserveSpend(ctx.tokenId, t.amountCents))) {
        throw new ToolError("SPEND_LIMIT", `Funding ${formatCents(t.amountCents, w.currency)} would pass this agent token's spend limit (${formatCents(ctx.spendLimitCents)}, ${formatCents(Math.max(0, ctx.spendLimitCents - ctx.spentCents))} left). Ask the person to mint a token with a higher limit.`);
      }
      try {
        const r = await svc.fundTranche(ctx.actor, t.id);
        await svc.audit(ctx.actor, "ai.mcp.request_funding", t.id, { tokenId: ctx.tokenId, amountCents: t.amountCents });
        return { trancheId: t.id, amount: formatCents(t.amountCents, w.currency), amountCents: t.amountCents, approveUrl: r.approveUrl, humanAction: "Give this link to the buyer. They approve the hold in PayPal; nothing is held until they do." };
      } catch (e) { await svc.releaseSpend(ctx.tokenId, t.amountCents); throw e; }
    },
  }),
  tool({
    name: "submit_evidence", title: "Submit milestone evidence",
    description: "Submit evidence for a milestone as a text note plus links (URLs). Files and photos are uploaded by people in the app. The client then reviews; the AI verifier report is advisory.",
    input: z.object({ contractId: id, milestoneId: id, note: z.string().min(3).max(4_000), urls: z.array(z.url({ protocol: /^https?$/ })).max(10).default([]) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(a, ctx, svc) {
      need(ctx.actor, "evidence.submit");
      const files = a.urls.map((u, i) => ({ name: `link-${i + 1}.url`, type: "text/uri-list", bytes: Buffer.from(u + "\n", "utf8") }));
      const r = await svc.submitEvidence(ctx.actor, a.milestoneId, files, a.note);
      await svc.audit(ctx.actor, "ai.mcp.submit_evidence", a.milestoneId, { tokenId: ctx.tokenId, packageId: r.packageId, links: files.length });
      return { packageId: r.packageId, rootHash: r.rootHash, signals: r.signals, next: "The client reviews the evidence in the app.", link: `${ctx.appUrl}/contracts/${a.contractId}/m/${a.milestoneId}` };
    },
  }),
  tool({
    name: "approve_release", title: "Ask the client to approve a release",
    description: "Request the release of a submitted milestone. HUMAN GATE: this moves no money. It records a pending request; the client confirms it in the app with MFA, which creates the signed approval.",
    input: z.object({ contractId: id, milestoneId: id, note: z.string().max(1_000).default("") }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(a, ctx, svc) {
      need(ctx.actor, "release.approve");
      let milestone: WorkspaceView["milestones"][number] | undefined;
      try {
        const w = await svc.getWorkspace(ctx.actor, a.contractId);
        milestone = w.milestones.find((m) => m.id === a.milestoneId || m.code === a.milestoneId);
        if (!milestone) throw new ToolError("NOT_FOUND", "That milestone is not part of this contract.");
        if (milestone.state !== "SUBMITTED") throw new ToolError("MILESTONE_STATE", `Milestone ${milestone.code} is ${milestone.state}; only submitted evidence can be approved.`);
      } catch (e) { if (!(e instanceof NotBuilt)) throw e; }
      const mid = milestone?.id ?? a.milestoneId;
      const r = await svc.createApproval(ctx.actor, { tokenId: ctx.tokenId, workspaceId: a.contractId, milestoneId: mid, note: a.note, detail: { amountCents: milestone?.amountCents } });
      return {
        approvalId: r.id, state: "PENDING", released: false, amount: milestone ? formatCents(milestone.amountCents) : undefined,
        confirmUrl: `${ctx.appUrl}/contracts/${a.contractId}/m/${mid}`,
        humanAction: "No money moved. The client opens the link and approves with MFA; only that signed approval releases the milestone.",
      };
    },
  }),
  tool({
    name: "open_dispute", title: "Open a dispute on a milestone",
    description: "Flag one milestone as disputed. Only that milestone's amount is frozen; the rest of the contract continues.",
    input: z.object({ milestoneId: id, reason: z.string().min(3).max(200), narrative: z.string().min(10).max(4_000) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(a, ctx, svc) {
      need(ctx.actor, "dispute.open");
      const did = await svc.openDispute(ctx.actor, a.milestoneId, a.reason, a.narrative);
      await svc.audit(ctx.actor, "ai.mcp.open_dispute", a.milestoneId, { tokenId: ctx.tokenId, disputeId: did });
      return { disputeId: did, state: "TIER1", next: "Both parties place sealed bids; a mediator decides if they do not converge." };
    },
  }),
];

export function toolList() {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input as z.ZodType, { io: "input" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, title: t.title, description: t.description, inputSchema: schema, annotations: t.annotations };
  });
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const err = (rid: Rpc["id"], code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0", id: rid ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });
const ok = (rid: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: rid ?? null, result });

function toolFailure(e: unknown): { code: string; message: string } {
  if (e instanceof ToolError) return { code: e.code, message: e.message };
  if (e instanceof NotBuilt) return { code: "NOT_BUILT", message: `${e.message}; this step is not available in this build yet.` };
  if (e instanceof DomainError) return { code: e.code, message: e.message };
  return { code: "INTERNAL", message: "The tool failed unexpectedly; nothing was changed by this call." };
}

export async function callTool(name: string, args: unknown, ctx: McpContext, svc: McpServices) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return null;
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ");
    return { content: [{ type: "text", text: `Invalid arguments: ${msg}` }], structuredContent: { error: { code: "INVALID_ARGUMENTS", message: msg } }, isError: true };
  }
  try {
    const data = await (t.run as (a: unknown, c: McpContext, s: McpServices) => Promise<Record<string, unknown>>)(parsed.data, ctx, svc);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: false };
  } catch (e) {
    const f = toolFailure(e);
    if (f.code === "INTERNAL") console.error("mcp tool failed", name, e);
    return { content: [{ type: "text", text: `${f.code}: ${f.message}` }], structuredContent: { error: f }, isError: true };
  }
}

const INSTRUCTIONS = "PaySettle holds a client's money through PayPal and releases it milestone by milestone. You act for the person who minted your token. You can draft and negotiate workspaces, read status, request funding (the buyer approves in PayPal), submit evidence notes and links, ask for a release (the client confirms in the app) and open disputes. You cannot sign, approve or move money yourself.";

async function one(msg: Rpc, ctx: McpContext, svc: McpServices): Promise<object | null> {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(msg?.id, -32600, "Invalid Request");
  const isNote = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      const version = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return ok(msg.id, { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping": return isNote ? null : ok(msg.id, {});
    case "tools/list": return ok(msg.id, { tools: toolList() });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const r = await callTool(name, msg.params?.arguments, ctx, svc);
      if (!r) return err(msg.id, -32602, `Unknown tool: ${name}`);
      return isNote ? null : ok(msg.id, r);
    }
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return isNote ? null : err(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Handle one HTTP POST body. Returns status 202 with no body when the message(s) were only notifications. */
export async function handleMcp(body: unknown, ctx: McpContext, svc: McpServices): Promise<{ status: number; body: unknown }> {
  if (Array.isArray(body)) {
    if (!body.length) return { status: 400, body: err(null, -32600, "Empty batch") };
    const out = (await Promise.all(body.slice(0, 20).map((m) => one(m as Rpc, ctx, svc)))).filter(Boolean);
    return out.length ? { status: 200, body: out } : { status: 202, body: null };
  }
  if (!body || typeof body !== "object") return { status: 400, body: err(null, -32700, "Parse error") };
  const r = await one(body as Rpc, ctx, svc);
  return r ? { status: 200, body: r } : { status: 202, body: null };
}
