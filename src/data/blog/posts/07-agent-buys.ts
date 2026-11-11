/* Sample post 7 (product). PaySettle facts from src/server/ai/mcp.ts (nine tools, human gates on request_funding,
 * approve_release and propose_change_order, spend reservation, audit actions ai.mcp.*), src/server/ai/agent.ts (token hash only, default
 * spend limit $15,000.00, default 24 h, max 720 h), src/app/api/mcp/route.ts and token/route.ts (Bearer token,
 * sandbox only, JSON-RPC 2.0 over Streamable HTTP), src/server/playground/scenarios.ts (S6). MCP quotes cite the spec. */
import { api, callout, cta, faq, h2, table, text, tldr, type SeedPost } from "../build";
import { MCP_SPEC } from "../sources";

export const POST_AGENT_BUYS: SeedPost = {
  slug: "letting-an-ai-agent-buy-a-service-safely",
  title: "Letting an AI agent buy a service safely",
  dek: "An assistant can find a provider, draft the contract and ask for funding on your behalf. What PaySettle lets it do over MCP, where a person has to step in, and why the spending cap sits on the token.",
  topic: "product",
  blocks: [
    tldr("t1", [
      "PaySettle runs an MCP server with nine tools, from searching blueprints to opening a dispute.",
      "An agent acts with a token its person creates. It can do no more than that person may, it expires (after 24 hours by default) and it carries a spend limit ($15,000.00 by default).",
      "Two human gates: a hold is funded only when the buyer approves it in PayPal, and money is released only when the client signs the approval in the app.",
      "Every tool call that changes something is written to the audit chain with the token that made it.",
    ], { claimStatus: "product" }),

    h2("h1", "Why agents change the risk"),
    text("p1", `Asking an assistant to "find someone to build our booking page for about six thousand dollars and get it started" is now a reasonable request. Most of the work in it (searching, drafting, comparing, chasing) is exactly what agents are good at. The difficult part is that buying a service is a chain of commitments: a contract, a hold on money, a release. An agent that can make all of them unsupervised is a spending account with a chat window.

The Model Context Protocol, which agents use to call tools, is candid about this. It asks hosts to obtain explicit user consent before invoking any tool, and it says the protocol itself cannot enforce its security principles; implementers should build the consent and authorization flows. We took that literally, and put the consent where the money is.`, { sources: [MCP_SPEC], claimStatus: "research" }),

    h2("h2", "The nine tools"),
    table("tb1", ["Tool", "What it does", "Where a person acts"], [
      ["search_blueprints", "Finds contract templates by text, vertical and duration. Read-only.", "Not needed"],
      ["draft_contract", "Creates a negotiation workspace from a brief, a budget and a duration. A draft, not a contract.", "Both parties review and sign in the app"],
      ["propose_changes", "Prunes, restores or appends steps, or changes shares, days, clauses or the total. Each change is a new revision.", "The other party sees the change; earlier signatures are voided"],
      ["get_contract_status", "Reads state, revision, tranches, milestones and policy problems. Read-only.", "Not needed"],
      ["request_funding", "Creates the PayPal order for one tranche and returns the approval link.", "The buyer approves the hold in PayPal"],
      ["submit_evidence", "Submits a note and links for a milestone. Files and photos are uploaded by people in the app.", "The client reviews"],
      ["approve_release", "Records a pending release request. Moves no money.", "The client confirms in the app with an authenticator code"],
      ["propose_change_order", "Proposes a change order on a signed contract: new dates, added steps, or steps removed before they start. Moves no money and changes nothing on its own.", "Both parties review it and sign in the app with an authenticator code"],
      ["open_dispute", "Disputes one milestone; only its amount is frozen.", "Both parties bid; a mediator decides if they do not meet"],
    ], { claimStatus: "product" }),

    h2("h3", "A token, not a password"),
    text("p2", `An agent never signs in as you. In the app you mint an agent token. It is shown once, only its hash is stored, and you can revoke it. The token carries three limits:

- **It acts as you, and no more.** Every tool runs the same permission checks as the screens, so a client's agent cannot do a provider's work, and nobody's agent can do what Operations does.
- **It expires.** After 24 hours by default, and 30 days at most.
- **It has a spend limit in cents.** $15,000.00 unless you choose another amount. Every funding request is reserved against it before an order is created at PayPal, and released again if the order fails.

In this build agent tokens are a sandbox feature: the endpoint that mints them refuses outside the sandbox.`, { claimStatus: "product" }),

    h2("h4", "Two places a person must act"),
    text("p3", `The first gate is funding. When an agent calls request_funding, PaySettle creates the PayPal order for the tranche and hands back the link. Nothing is held until the buyer opens that link and approves in PayPal, on PayPal's own pages. The agent gets a sentence saying so, written for it to pass on.`, { claimStatus: "product" }),
    api("a1", "POST", "/api/mcp", `Authorization: Bearer <AGENT_TOKEN>

{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "request_funding",
    "arguments": { "contractId": "<CONTRACT_ID>", "trancheIdx": 1 }
  }
}`, `{
  "trancheId": "<TRANCHE_ID>",
  "amount": "$6,000.00",
  "amountCents": 600000,
  "approveUrl": "https://www.sandbox.paypal.com/checkoutnow?token=<ORDER_ID>",
  "humanAction": "Give this link to the buyer. They approve the hold in PayPal; nothing is held until they do."
}`, "Illustrative sandbox call, shortened to the tool's structured result. Placeholders in angle brackets; no real token is ever shown.", { claimStatus: "illustrative" }),
    text("p4", `The second gate is release. The tool is called approve_release, because that is what an agent will look for, but it releases nothing. It records a pending request and returns a link to the milestone. The client opens it, looks at the evidence, and approves with a code from an authenticator app. That signed approval is the only thing that can release the milestone's money.`, { claimStatus: "product" }),
    api("a2", "POST", "/api/mcp", undefined, `{
  "approvalId": "<APPROVAL_ID>",
  "state": "PENDING",
  "released": false,
  "amount": "$1,500.00",
  "confirmUrl": "https://<YOUR_PAYSETTLE_HOST>/contracts/<CONTRACT_ID>/m/<MILESTONE_ID>",
  "humanAction": "No money moved. The client opens the link and approves with MFA; only that signed approval releases the milestone."
}`, "Illustrative result of approve_release. The words in humanAction are the tool's own.", { claimStatus: "illustrative" }),
    callout("c1", "warn", "What we left out on purpose", "There is no tool to sign a contract, to approve evidence on the client's behalf, to issue a verdict, or to change a token's own limits. An agent misled by instructions hidden in a web page can still only read, draft, propose and ask.", { claimStatus: "product" }),

    h2("h5", "A record of what the agent did"),
    text("p5", `Every tool call that changes something is written to PaySettle's hash-chained audit log, tagged with the token that made it: a draft created, changes proposed, funding requested, evidence submitted, a release requested, a dispute opened. When someone asks "did my assistant do this?", the answer is a row with a time, not a guess.

The agent's view is limited in the same way as its actions. It sees what its person could see in the app, nothing more, and every error it receives says plainly what is missing: a signature, a funded tranche, a higher spend limit.`, { claimStatus: "product" }),

    h2("h6", "What this looks like end to end"),
    text("p6", `Scenario S6 in the Judge Playground runs a consulting sprint over MCP with two agents, one for each party. The client's agent drafts the contract from a one-paragraph brief. The provider's agent proposes an extra first milestone and rebalances the shares. Then the people sign, because agents cannot. The client's agent requests funding and gets back a PayPal link; the person approves the hold. The provider's agent submits evidence. The client's agent asks for the release, and only when the client confirms it in the app with an authenticator code does money move. Each human step is its own action in the scenario, so you can see exactly where the agents' reach ends.`, { claimStatus: "product" }),

    faq("f1", [
      { q: "Which agents can connect?", a: "Any MCP client that speaks JSON-RPC 2.0 over Streamable HTTP and can send a bearer token. The server answers with JSON; it does not stream." },
      { q: "What if the agent tries to fund more than its limit?", a: "The request is refused before any PayPal order exists. The agent is told the limit, the amount left, and to ask its person for a token with a higher limit." },
      { q: "Can I stop an agent mid-task?", a: "Revoke its token in the app. The next call it makes is refused, and anything waiting for a person, such as a release request, stays waiting until a person acts." },
    ], { claimStatus: "product" }),
    cta("cta1", "Watch two agents stop where they should", "Open the Judge Playground", "/playground", "Scenario S6: a consulting sprint drafted, funded and released over MCP, with every human gate shown."),
  ],
};
