/**
 * P3 A5 A7 — the AI boundary, checked statically. AI code may read and advise; it must not be able to reach code that
 * moves money or writes a contract, a ledger row, a signature, a release or a verdict.
 *
 * AI modules: every file under src/lib/ai and src/server/ai, plus any file in src/server or src/lib that imports the
 * model gateway (src/lib/ai/gateway.ts or the gateway singleton in src/server/ai/store.ts).
 * Money and record writers: src/server/money/**, src/lib/rails/**, and every other file that imports them or inserts or
 * updates the ledger, release, refund, verdict, signature, revision or approval tables.
 * The check follows runtime imports transitively (static, dynamic and re-exports; type-only imports are erased at
 * build time and skipped). One file is a deliberate, narrow exception: src/server/ai/mcp-services.ts binds the MCP
 * agent tools to module entry points that are themselves human-gated; it is checked member by member below.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(process.cwd(), "src");
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const isTest = (f: string) => /\.test\.tsx?$/.test(f);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const f = path.join(dir, name);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(f);
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/** Module specifiers a file loads at run time. */
function runtimeImports(file: string): string[] {
  const text = stripComments(readFileSync(file, "utf8"));
  const out: string[] = [];
  const fromRe = /(?:^|[;\n}])\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']/g;
  for (let m = fromRe.exec(text); m; m = fromRe.exec(text)) {
    if (m[2]) continue; // import type … / export type …
    const clause = m[3].trim();
    const names = /^\{([^}]*)\}$/.test(clause) ? clause.slice(1, -1).split(",").map((x) => x.trim()).filter(Boolean) : null;
    if (names && names.length && names.every((x) => x.startsWith("type "))) continue; // import { type A, type B }
    out.push(m[4]);
  }
  for (const re of [/(?:^|[;\n])\s*import\s*["']([^"']+)["']/g, /import\(\s*["']([^"']+)["']\s*\)/g]) {
    for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]);
  }
  return out;
}

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return path.resolve(c);
  }
  throw new Error(`${rel(from)} imports ${spec}, which does not resolve to a file under src`);
}

const ALL = walk(SRC).filter((f) => !isTest(f));
const edges = new Map(ALL.map((f) => [f, runtimeImports(f).map((s) => resolve(f, s)).filter((x): x is string => x !== null)]));

/** Every file reachable from `root` at run time, with the import chain that reaches it. */
function closure(root: string): Map<string, string[]> {
  const chain = new Map<string, string[]>([[root, [rel(root)]]]);
  const queue = [root];
  while (queue.length) {
    const f = queue.shift()!;
    for (const g of edges.get(f) ?? []) {
      if (chain.has(g)) continue;
      chain.set(g, [...chain.get(f)!, rel(g)]);
      queue.push(g);
    }
  }
  return chain;
}

const MONEY_DIRS = ["server/money/", "lib/rails/"];
const RECORD_TABLES = "ledgerEntries|releases|refunds|verdicts|signatures|revisions|evidenceReviews|changeOrderSignatures|releaseAdjustments";
const WRITES_RECORDS = new RegExp(`\\.(insert|update|delete)\\(\\s*(${RECORD_TABLES})\\s*\\)`);
const inMoney = (f: string) => MONEY_DIRS.some((d) => rel(f).startsWith(d));
const writers = new Set(ALL.filter((f) => inMoney(f) || (edges.get(f) ?? []).some(inMoney) || WRITES_RECORDS.test(stripComments(readFileSync(f, "utf8")))));

const importsGateway = (f: string) => /from\s*["'](@\/lib\/ai\/gateway|@\/server\/ai\/store)["']/.test(readFileSync(f, "utf8"));
const AI = ALL.filter((f) => {
  const r = rel(f);
  return r.startsWith("lib/ai/") || r.startsWith("server/ai/") || ((r.startsWith("server/") || r.startsWith("lib/")) && importsGateway(f));
});
const MCP_SERVICES = path.join(SRC, "server", "ai", "mcp-services.ts");

describe("AI boundary (static)", () => {
  it("P3 the scanner sees the AI modules and the money writers it is meant to separate", () => {
    const ai = AI.map(rel);
    for (const f of ["lib/ai/gateway.ts", "lib/ai/untrusted.ts", "server/ai/index.ts", "server/ai/mcp.ts", "server/ai/agent.ts", "server/ai/store.ts", "server/identity/ocr.ts", "server/blog/service.ts"]) expect(ai).toContain(f);
    const w = [...writers].map(rel);
    for (const f of ["server/money/index.ts", "server/money/webhook.ts", "lib/rails/mock.ts", "lib/rails/paypal.ts", "server/evidence/index.ts", "server/disputes/index.ts", "server/contracts/index.ts", "server/contracts/change-orders.ts"]) expect(w).toContain(f);
    // the resolver follows real edges: the evidence module reaches money (it triggers the release after a signed approval)
    expect([...closure(path.join(SRC, "server", "evidence", "index.ts")).keys()].map(rel)).toContain("server/money/index.ts");
  });

  it("P3 A7 no AI module can reach money-moving code or a contract, ledger, signature, release or verdict writer", () => {
    const leaks: string[] = [];
    for (const root of AI) {
      if (root === MCP_SERVICES) continue;
      for (const [f, chain] of closure(root)) if (writers.has(f)) leaks.push(chain.join(" → "));
    }
    expect(leaks).toEqual([]);
  });

  it("P3 A5 the MCP bindings hand agents only human-gated entry points, never a release, approval, signature or verdict", () => {
    const text = stripComments(readFileSync(MCP_SERVICES, "utf8"));
    const used = (ns: string) => [...new Set([...text.matchAll(new RegExp(`\\b${ns}\\.(\\w+)`, "g"))].map((m) => m[1]))].sort();
    // request_funding creates a PayPal order; nothing is held until the buyer approves it in PayPal
    expect(used("money")).toEqual(["fundTranche"]);
    expect(used("evidence")).toEqual(["submitEvidence"]);
    expect(used("disputes")).toEqual(["openDispute"]);
    expect(used("contracts")).toEqual(["applyChange", "createWorkspace", "getWorkspace"]);
    const named = [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)].map((m) => ({ from: m[2], names: m[1].split(",").map((x) => x.trim().replace(/^type\s+/, "")).filter(Boolean) }));
    expect(named.find((n) => n.from === "../contracts/change-orders")?.names.sort()).toEqual(["changeOrderSummary", "proposeChangeOrder"]);
    expect(named.find((n) => n.from === "./agent")?.names.sort()).toEqual(["createAgentApproval", "releaseSpend", "reserveSpend"]);
    const MOVERS = /\b(releaseMilestone|returnToClient|confirmTranche|rollover|settleChangeOrder|runWatchdog|approveMilestone|requestFix|runReviewTimers|issueVerdict|cosignVerdict|placeBid|retryExecution|lockVault|sealVault|signChangeOrder|sign|clearContract|resolveAgentApproval|processWebhookEvent)\b/;
    expect(text.match(MOVERS)?.[0] ?? null).toBeNull();
    // the service interface the tools are written against has no such member either
    const mcp = stripComments(readFileSync(path.join(SRC, "server", "ai", "mcp.ts"), "utf8"));
    const iface = mcp.slice(mcp.indexOf("export interface McpServices"), mcp.indexOf("class ToolError"));
    expect(iface.length).toBeGreaterThan(100);
    expect(iface.match(MOVERS)?.[0] ?? null).toBeNull();
  });
});
