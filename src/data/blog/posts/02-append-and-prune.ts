/* Sample post 2 (product). PaySettle facts from src/server/contracts/index.ts (applyOne moves, SYSTEM_CLAUSE_LOCKED,
 * signature voiding, MERGE_REQUIRED, sign R09 + MFA, lock), src/server/contracts/core.ts (canonicalDoc, diffDocs,
 * recomputeAmounts), src/db/sql/guards.sql (revisions append-only), src/data/blueprints/system.ts (six system clauses),
 * src/lib/policy.ts (R01–R10, riskScore weights, RISK_OPS_THRESHOLD 75), src/server/ai/mcp.ts (propose_changes). */
import { callout, cta, faq, h2, image, stats, steps, table, text, tldr, type SeedPost } from "../build";

export const POST_APPEND_PRUNE: SeedPost = {
  slug: "append-and-prune",
  title: "Append-and-Prune: why nobody can edit a contract clause",
  dek: "A PaySettle contract changes in a few fixed ways: a step is switched off, a step is added, or a number moves. Why we left out the edit button, and what that gives both parties.",
  topic: "product",
  blocks: [
    tldr("t1", [
      "Every contract starts from a blueprint: baseline milestones with proof specs, baseline clauses, and six system clauses.",
      "You can prune (switch off) a baseline milestone or clause, restore it, append your own, and change shares, days and the total. There is no way to rewrite the words of an existing clause.",
      "Every change is a new revision with its own SHA-256 hash. Revisions cannot be updated or deleted, and any change voids the signatures on the revision before it.",
      "Both signatures must name the same revision and the same hash before the contract locks.",
    ], { claimStatus: "product" }),

    h2("h1", "Where the edit button went"),
    text("p1", `Most contract tools open a document and let either side type into it. That is flexible, and it is exactly where trust wears thin. A clause that was quietly reworded on page seven between two drafts is a clause somebody argues about later, usually after the money has moved. Between two parties who met last week, the question "what did we actually agree?" needs an answer that does not depend on anyone's memory or anyone's diff tool.

So a PaySettle contract is not a document first. It is structured data: a list of milestones, each with a target day, a share of the total, a proof spec saying what evidence counts, and two rules (what locks it, and how a dispute about it is decided), plus a list of clauses. The blueprint supplies vetted defaults for all of it. The parties negotiate by changing the list, and only through a small, fixed set of moves.`, { claimStatus: "product" }),
    table("tb1", ["Move", "What it does", "Typical use"], [
      ["Prune", "Switches off a baseline milestone or clause. It stays in the contract, marked as pruned, with who pruned it.", "No separate frame inspection on a car that has one on file."],
      ["Restore", "Switches a pruned item back on.", "Undoing a prune while you negotiate."],
      ["Append", "Adds a milestone (codes C01, C02 …) or a custom clause (CUS_01 …) with its own proof spec and rules.", "An extra checkpoint the client cares about."],
      ["Set share or day", "Moves a milestone's share of the total or its target day.", "Rebalancing when the work is paid out."],
      ["Set total", "Changes the contract total; every amount is recomputed to the cent.", "Agreeing a different price."],
    ], { claimStatus: "product" }),
    callout("c1", "info", "What is missing on purpose", "No move rewrites the text of a clause that is already in the contract. If a baseline clause does not fit, you prune it and append your own wording as a custom clause. Both stay in the record, side by side, so anyone can see what the template said and what the parties chose instead.", { claimStatus: "product" }),

    h2("h2", "System clauses cannot be pruned"),
    text("p2", `Six system clauses travel with every contract: funds are held through PayPal; the hold window; release is final once a signed approval or verdict releases a milestone; evidence and review (the client reviews within 48 hours, with reminders at 24 and 36 hours); disputes are scoped to one milestone; and no side payments. The negotiation room refuses to switch any of them off, and the policy gate refuses a revision in which one is off (rule R07).

Custom clauses are read as well. Before anyone can sign, each one is checked against a list of patterns that try to undo a system rule: paying outside PayPal, waiving dispute rights, releasing everything up front, making the money refundable after signature. A clause that matches is reported as a contradiction, and the revision cannot be signed until the clause is changed or removed.`, { claimStatus: "product" }),

    h2("h3", "Every change is a revision"),
    image("i1", "/blog/append-and-prune.svg", "Three revisions: revision 1 from the blueprint; revision 2 prunes M05 and the client signs it; revision 3 appends C01, which voids that signature, and both parties sign revision 3.", "Each move makes a new revision with its own hash. A signature belongs to one revision and does not carry over."),
    steps("s1", "What happens on every move", [
      { title: "The move is applied", body: "The server applies the change, recomputes every amount by largest remainder so the payment milestones add up to the total to the cent, and plans the tranches again." },
      { title: "The policy gate runs", body: "Ten deterministic rules check the new revision. Among them: shares add up to exactly 100%, every milestone fits its hold window, dependencies run forward in time, no more than 40% is paid in the first fifth of the timeline without a signed deposit waiver, and every paid milestone names concrete proof." },
      { title: "A revision is written", body: "The contract is serialised as canonical JSON and hashed with SHA-256. The revision row is append-only: a database trigger refuses any update or delete." },
      { title: "Older signatures are voided", body: "If either party had signed the previous revision, that signature is marked void at the new revision number. Nobody can be held to a version they have not seen." },
    ], { claimStatus: "product" }),
    text("p3", `Two people editing at once get the same care. If the other party changed the contract while you were working, your move is refused with a plain message asking you to review the latest revision first, instead of silently overwriting theirs. And any revision can be compared with revision 1: what was pruned, restored and appended, and which fields of which milestones changed.`, { claimStatus: "product" }),

    h2("h4", "Signing binds a hash, not a page"),
    text("p4", `When you sign, you sign a revision number and its hash. The second signature is accepted only if it names the same revision and the same hash as the first (rule R09). Outside the sandbox, signing also needs a fresh code from an authenticator app. Only then does the contract lock: milestones freeze, the tranches are created, and the first milestones open for work.

Because the hash covers the whole canonical document (total, fee, rail, every milestone with its proof spec and rules, every clause with its on or off state), "the contract" is a precise object. A mediator reading a dispute weeks later reads exactly what both parties signed, and can check it.`, { claimStatus: "product" }),

    h2("h5", "Pruning a protection has a visible cost"),
    text("p5", `Pruning is allowed, including protective baseline clauses such as a workmanship warranty or ownership of paid materials. It is not invisible. The contract's risk score is a published formula: 30% of its weight is the contract's value band, 25% is the share of protective clauses pruned, 20% is the share of custom clauses, 15% is the provider's trust tier and 10% is front-loading of payments. A contract that scores 75 or more is sealed by both signatures but waits for an Operations review before it locks.

The score is not tied to anything PaySettle earns. It exists so that a client who pruned the warranty, accepted three custom clauses and agreed to pay a third up front sees, in one number, that the contract leans one way.`, { claimStatus: "product" }),
    stats("st1", [
      { value: "6", label: "system clauses in every contract" },
      { value: "10", label: "policy rules on every revision" },
      { value: "75", label: "risk score that adds an Operations review" },
    ], { claimStatus: "product", anim: "countUp" }),

    faq("f1", [
      { q: "Can I fix a typo in a clause?", a: "Prune the clause and append a corrected custom clause. It takes two moves, and the other party sees exactly what changed." },
      { q: "What happens to my signature if the other side changes something?", a: "It is voided at the new revision. You review the comparison and sign the new revision if you agree with it." },
      { q: "Can an AI agent change a contract?", a: "An agent can propose the same moves through PaySettle's MCP server, acting as the person who issued its token. Each move becomes a normal revision that the other party sees. There is no tool for signing, so an agent cannot sign." },
      { q: "Why not just track changes in a document?", a: "Tracked changes describe text. Our moves describe the money: which milestone pays what, on which proof, by which day. That is what both parties need to agree on, and what the policy gate can check." },
    ], { claimStatus: "product" }),
    cta("cta1", "Negotiate a contract yourself", "Try the live demo", "/login", "Pick a client and a provider, prune a step, append one, and watch the signatures void and the hash change."),
  ],
};
