import fs from "node:fs";
import { launch, as, close, loadState, saveState, shot, room, settle, toDay, q, mainText, BASE } from "./lib.mjs";
import { deliver, approve, msUrl } from "./evidence.mjs";
import { changeOrder } from "./co.mjs";
import { fund } from "./s03-fund.mjs";
const b = await launch(); const st = loadState(); const ws = st.p3;
const dan = await as("dan"), arjun = await as("arjun");
const mcpLog = JSON.parse(fs.existsSync("/home/user/paysettle/sim/mcp-log.json") ? fs.readFileSync("/home/user/paysettle/sim/mcp-log.json","utf8") : "[]");
async function mcp(token, method, params, label) {
  const r = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: mcpLog.length + 1, method, params }) });
  const j = await r.json();
  mcpLog.push({ label, request: { method, params }, status: r.status, response: j });
  console.log("MCP", label, r.status, JSON.stringify(j).slice(0, 600));
  return j;
}
// week 9: the provider's agent works over MCP with a scoped token
await toDay(ws, 15);
const tokA = await (await arjun.request.post("/api/mcp/token", { data: { label: "Arjun's release agent", spendLimitCents: 0, ttlHours: 24 } })).json();
console.log("token minted", Object.keys(tokA));
await mcp(tokA.token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "provider-agent", version: "1.0" } }, "initialize");
await mcp(tokA.token, "tools/list", {}, "tools/list");
await mcp(tokA.token, "tools/call", { name: "get_contract_status", arguments: { contractId: ws } }, "provider agent reads status");
const storeId = (await msUrl(ws, "C03")).split("/").pop();
const URLS = ["https://play.google.com/store/apps/details?id=example.paysettle.sample", "https://apps.apple.com/app/paysettle-sample/id0000000000"];
await mcp(tokA.token, "tools/call", { name: "submit_evidence", arguments: { contractId: ws, milestoneId: storeId, note: "Store listings submitted by the provider's agent (sample links, simulation on sandbox data):\n" + URLS.join("\n"), urls: URLS } }, "retry: provider agent submits store-listing evidence with the links also in the note");
await mcp(tokA.token, "tools/call", { name: "submit_evidence", arguments: { contractId: ws, milestoneId: storeId, note: "Store listings submitted by the provider's agent: Play Store and App Store pages with description, privacy details and screenshots. Sample links, simulation on sandbox data.", urls: ["https://play.google.com/store/apps/details?id=example.paysettle.sample", "https://apps.apple.com/app/paysettle-sample/id0000000000"] } }, "provider agent submits store-listing evidence");
await mcp(tokA.token, "tools/call", { name: "approve_release", arguments: { contractId: ws, milestoneId: storeId, note: "Both listings are live in review; please approve C03." } }, "provider agent asks for release (human gate)");
const tokD0 = await (await dan.request.post("/api/mcp/token", { data: { label: "Dan's review agent", spendLimitCents: 0, ttlHours: 24 } })).json();
await mcp(tokD0.token, "tools/call", { name: "approve_release", arguments: { contractId: ws, milestoneId: storeId, note: "Store listings look complete; queue C03 for my approval." } }, "client agent records a release request (moves no money)");
await arjun.goto("/account/ai"); await settle(arjun); await shot(arjun, "w09-provider-ai-agents-token");
await approve(dan, await msUrl(ws, "C03"), { shotName: "w09-client-review-c03-agent-evidence" });
await shot(dan, "w09-client-released-c03", false);
// week 10: content and marketing added in the last week
await toDay(ws, 18);
const co = await changeOrder(ws, { by: "dan", prefix: "w10", tag: "add-content-marketing", note: "Last-week addition: landing page, launch blog posts and store screenshots for the launch.", add: [{ title: "Landing page, launch blog posts and store screenshots", day: 22, amount: "3,000", artifact: "IMAGE", min: 3, criteria: ["Landing page is live with pricing and how-it-works sections", "Three launch blog posts are published", "Store screenshot sets for Android and iOS are uploaded"] }] });
st.co_p3 = co.reviewText; saveState(st);
const tokD = await (await dan.request.post("/api/mcp/token", { data: { label: "Dan's purchasing agent", spendLimitCents: 100000, ttlHours: 24 } })).json();
await mcp(tokD.token, "tools/call", { name: "request_funding", arguments: { contractId: ws } }, "client agent asks to fund the new $3,000 tranche with a $1,000 spend limit");
for (const t of await q("select idx from tranches where workspace_id=$1 and state='PLANNED' order by idx", [ws])) await fund(ws, t.idx, "w10");
await deliver(b, ws, "M01", 20, { prefix: "w10", shots: true, note: "Production launch: web at the production URL, backups and monitoring on (tech lead). Sample links." });
const newCode = (await q("select code from ws_milestones where workspace_id=$1 and title like 'Landing page%'", [ws]))[0].code;
await deliver(b, ws, newCode, 22, { prefix: "w10", shots: true, note: "Landing page, three launch blog posts and store screenshot sets (designer). Sample screenshots." });
await deliver(b, ws, "M02", 24, { prefix: "w10", shots: true, note: "Runbook, README and knowledge-transfer recording; client owns every account (tech lead). Sample files." });
await room(dan, ws); await shot(dan, "w10-client-period-3-complete");
await room(arjun, ws); await shot(arjun, "w10-provider-period-3-complete", false);
fs.writeFileSync("/home/user/paysettle/sim/mcp-log.json", JSON.stringify(mcpLog, null, 2));
await close(); process.exit(0);
