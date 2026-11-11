#!/usr/bin/env node
// A5 · Playground scenario S6 (agentic consulting sprint) driven end to end over MCP against a running server.
// The agent drafts and asks for money; people sign, approve in PayPal and confirm the release in the app.
//
//   npx tsx evals/mint-token.ts u_dan      → export PAYSETTLE_AGENT_TOKEN=psa_…      (client's agent)
//   npx tsx evals/mint-token.ts u_arjun    → export PAYSETTLE_PROVIDER_TOKEN=psa_…   (provider's agent, optional)
//   node evals/mcp-demo.mjs [--url http://localhost:3000] [--contract ws_…] [--no-wait]
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const BASE = (opt("--url", process.env.PAYSETTLE_URL ?? "http://localhost:3000")).replace(/\/+$/, "");
const CLIENT = process.env.PAYSETTLE_AGENT_TOKEN;
const PROVIDER = process.env.PAYSETTLE_PROVIDER_TOKEN;
const WAIT = !args.includes("--no-wait");
let contractId = opt("--contract", null);
let nextId = 1;

if (!CLIENT) {
  console.error("Set PAYSETTLE_AGENT_TOKEN first. Mint one in the app (Account → AI & agents) or run: npx tsx evals/mint-token.ts u_dan");
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const pause = async (msg) => { console.log(`\n  HUMAN STEP: ${msg}`); if (WAIT) await rl.question("  Press Enter when done… "); };
const show = (label, v) => console.log(`\n▸ ${label}\n${JSON.stringify(v, null, 2).split("\n").map((l) => "  " + l).join("\n")}`);

async function rpc(token, method, params) {
  const body = { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}), ...(method.startsWith("notifications/") ? {} : { id: nextId++ }) };
  const res = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (res.status === 202) return null;
  const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}
async function tool(token, name, a) {
  const r = await rpc(token, "tools/call", { name, arguments: a });
  if (r.isError) { console.log(`\n✗ ${name}: ${r.content?.[0]?.text}`); return null; }
  show(name, r.structuredContent);
  return r.structuredContent;
}

async function main() {
  const init = await rpc(CLIENT, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "paysettle-mcp-demo", version: "1.0" } });
  await rpc(CLIENT, "notifications/initialized");
  console.log(`Connected to ${init.serverInfo.title} (protocol ${init.protocolVersion}) at ${BASE}/api/mcp`);
  const { tools } = await rpc(CLIENT, "tools/list");
  console.log(`Tools: ${tools.map((t) => t.name).join(", ")}`);

  if (!contractId) {
    await tool(CLIENT, "search_blueprints", { query: "ERP planning consulting sprint", maxDays: 30 });
    const d = await tool(CLIENT, "draft_contract", {
      brief: "Supply planning sprint: configure SAP IBP demand and supply planning for 3 plants, with integration test, UAT by named key users, go-live and hypercare.",
      budgetCents: 1_200_000, days: 24, providerEmail: "arjun@provider.demo",
    });
    if (!d) return;
    contractId = d.contractId;
    await pause(`Open ${d.link}, review the draft, and sign it as the client and as the provider (each with MFA).`);
  }

  const st = await tool(CLIENT, "get_contract_status", { contractId });
  if (!st) return;
  const f = await tool(CLIENT, "request_funding", { contractId });
  if (f) await pause(`The buyer opens ${f.approveUrl} and approves the hold in PayPal (sandbox). Nothing is held until then.`);

  const after = await tool(CLIENT, "get_contract_status", { contractId });
  const target = after?.milestones?.find((m) => m.type === "PAY" && (m.state === "OPEN" || m.state === "SUBMITTED"));
  if (!target) { console.log("\nNo open paid milestone yet (is the tranche held?). Re-run with --contract " + contractId); return; }

  if (target.state === "OPEN") {
    if (!PROVIDER) { console.log(`\nSet PAYSETTLE_PROVIDER_TOKEN (npx tsx evals/mint-token.ts u_arjun) to let the provider's agent submit evidence for ${target.code}.`); return; }
    await tool(PROVIDER, "submit_evidence", { contractId, milestoneId: target.id, note: `${target.title}: assessment report and process list uploaded to the shared folder.`, urls: ["https://example.com/sprint/assessment-report.pdf", "https://example.com/sprint/process-list.pdf"] });
  }
  const a = await tool(CLIENT, "approve_release", { contractId, milestoneId: target.id, note: "Evidence looks complete to the agent; please review." });
  if (a) await pause(`No money moved. The client opens ${a.confirmUrl} and approves with MFA; only that signed approval releases ${target.code}.`);
  await tool(CLIENT, "get_contract_status", { contractId });
  console.log("\nDone.");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => rl.close());
