import { launch, as, close, loadState, saveState, shot, room, settle, toDay, mainText } from "./lib.mjs";
import { deliver } from "./evidence.mjs";
import { changeOrder } from "./co.mjs";
import { fund } from "./s03-fund.mjs";
const b = await launch(); const st = loadState(); const ws = st.p2;
const dan = await as("dan"), arjun = await as("arjun");
await toDay(ws, 1);
await room(dan, ws); await shot(dan, "w04-client-period-2-funded");
await deliver(b, ws, "C01", 7, { prefix: "w04", shots: true, note: "Evidence vault with SHA-256 hashes, scoped disputes with sealed offers, mediator console (engineer 1, QA). Sample walkthrough." });
// week 5: feature swap
await toDay(ws, 8);
const co2 = await changeOrder(ws, { by: "dan", prefix: "w05", tag: "swap-chat-for-mcp", note: "Feature change in week 5: in-app chat is replaced by agent access over MCP with spend limits. Chat has not started.", edits: { M01: { title: "Agent access over MCP with spend limits", amount: "6000.00", proof: "1 × LOG — MCP session log: scoped token, status checks and a refused over-limit request (sample)\n1 × VIDEO — Walkthrough: an agent proposes, a person approves every money move (sample)", criteria: ["An agent can read contract status and submit evidence with a scoped token", "Every money move still needs a person's signed approval", "Requests above the token's spend limit are refused and logged"] } } });
st.co2 = co2.reviewText; saveState(st);
// fund any new tranche the swap created
const tr = (await import("./lib.mjs")).q;
for (const t of await tr("select idx, state from tranches where workspace_id=$1 and state='PLANNED' order by idx", [ws])) await fund(ws, t.idx, "w05");
await deliver(b, ws, "C02", 12, { prefix: "w05", shots: false, note: "AI verifier, drafting agent and three-way reconciliation (engineer 2, tech lead). Eval run log attached (sample)." });
await toDay(ws, 13);
const co3 = await changeOrder(ws, { by: "dan", prefix: "w05", tag: "drop-offline-mode", note: "Offline mode is dropped from the build: not started, money goes back to the client.", remove: ["M03"] });
st.co3 = co3.reviewText; saveState(st);
await deliver(b, ws, "M01", 14, { prefix: "w05", shots: true, note: "Agent access over MCP: scoped tokens with spend limits; every money move waits for a person (tech lead). Sample log and walkthrough." });
// week 6: deadline extension for the Android build
await toDay(ws, 16);
const co4 = await changeOrder(ws, { by: "arjun", prefix: "w06", tag: "android-deadline-extension", note: "Play Console review of the internal testing track takes longer than planned; Android build due day 20 → day 23. Amount unchanged.", edits: { C03: { day: 23 } } });
st.co4 = co4.reviewText; saveState(st);
await deliver(b, ws, "C03", 23, { prefix: "w07", shots: true, note: "Android build on the internal testing track; create, fund, approve and release journeys pass on a Pixel test device (QA). Sample screenshots." });
await room(dan, ws); await shot(dan, "w07-client-period-2-room");
await close(); process.exit(0);
