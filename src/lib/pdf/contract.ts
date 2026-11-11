/**
 * F2.10 contract PDF: parties, milestones, clauses (system / baseline / custom), the canonical hash both signatures
 * bind to, the signatures with time, and the revision. The canonical JSON is attached to the file so anyone can
 * recompute the SHA-256 and compare it with the hash printed here (P5). Pure rendering: data comes from
 * src/server/control/documents.ts.
 */
import { formatCents, pct } from "@/lib/money";
import { fmtIso, pdfText, renderPdf, short } from "./doc";

export interface ContractPdfMilestone { code: string; title: string; type: "GATE" | "PAY"; day: number; bps: number; amountCents: number; origin: string; active: boolean; tranche: number; criteria: string[]; artifacts: string; lockRule: string; disputeRule: string }
export interface ContractPdfClause { category: "SYSTEM" | "BASELINE" | "CUSTOM"; code: string; title: string; body: string; active: boolean }
export interface ContractPdfSignature { role: "client" | "provider"; name: string; revNo: number; hash: string; mfa: boolean; at: Date; voidedAtRev: number | null }
export interface ContractPdfData {
  id: string; title: string; blueprintCode: string; blueprintTitle: string | null; state: string; currency: string; totalCents: number; feeBps: number; rail: string;
  reviewTimeoutRule: string; createdAt: Date;
  client: { id: string; name: string }; provider: { id: string; name: string } | null; inviteEmail: string | null;
  revision: { revNo: number; hash: string; recomputed: string; createdAt: Date } | null;
  milestones: ContractPdfMilestone[]; clauses: ContractPdfClause[]; signatures: ContractPdfSignature[];
  /** Signed terms this renderer does not know by name (for example deadline terms); printed as data. */
  extraTerms: Record<string, unknown>;
  canonicalJson: string | null;
  tranches: { idx: number; amountCents: number; startDay: number; endDay: number; state: string }[];
  generatedAt: Date; generatedFor: string;
}

const RAIL_WHERE: Record<string, string> = {
  A1: "Each tranche is authorised in the client's PayPal account with the provider as payee. PayPal holds it; PaySettle never receives it.",
  A2: "Sandbox rail: PayPal captures to the PaySettle sandbox account and pays the provider out. Not used in production.",
  B: "PayPal captures each tranche and delays the disbursement to the provider until a milestone is approved.",
  MOCK: "Simulated rail used in the playground. No real money moves.",
};

function terms(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "object") return String(v);
  if (depth > 3) return "…";
  if (Array.isArray(v)) return v.map((x) => terms(x, depth + 1)).join("; ");
  return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${terms(x, depth + 1)}`).join(", ");
}

export async function contractPdf(d: ContractPdfData): Promise<Buffer> {
  const money = (c: number) => formatCents(c, d.currency);
  const live = d.signatures.filter((s) => s.voidedAtRev === null);
  const signedBy = (role: "client" | "provider") => live.find((s) => s.role === role && d.revision && s.revNo === d.revision.revNo);
  const both = Boolean(signedBy("client") && signedBy("provider"));
  return renderPdf(
    { title: `${d.title} — contract revision ${d.revision?.revNo ?? "draft"}`, subject: "PaySettle milestone contract", keywords: `PaySettle, contract, ${d.id}, ${d.revision?.hash ?? ""}` },
    `PaySettle contract ${d.id} · revision ${d.revision?.revNo ?? "draft"} · hash ${short(d.revision?.hash, 12)}`,
    (w) => {
      w.title(d.title, `Milestone contract · ${d.blueprintTitle ?? d.blueprintCode} · revision ${d.revision?.revNo ?? "draft"} · ${d.state.toLowerCase().replace(/_/g, " ")}`);
      w.notice(`Where the money is: ${RAIL_WHERE[d.rail] ?? "Held through PayPal per tranche."} Contract total ${money(d.totalCents)}; platform fee ${pct(d.feeBps)} on released amounts only.`);
      if (!both) w.notice(d.revision ? "This revision is not signed by both parties yet. It is a working copy, not a signed contract." : "No revision has been sealed yet. This is a working copy.");

      w.h2("Parties");
      w.kv([
        ["Client", `${d.client.name} (${d.client.id})`],
        ["Provider", d.provider ? `${d.provider.name} (${d.provider.id})` : d.inviteEmail ? `Invited, not yet joined (${d.inviteEmail})` : "Not yet invited"],
        ["Contract id", d.id],
        ["Created", fmtIso(d.createdAt)],
      ]);

      w.h2("Terms");
      w.kv([
        ["Total", money(d.totalCents)],
        ["Platform fee", `${pct(d.feeBps)} of each released amount (none on returned amounts)`],
        ["Payment rail", d.rail],
        ["Review timeout", d.reviewTimeoutRule === "DEEMED_APPROVED" ? "If the client does not review within 72 hours, the milestone is deemed approved." : "If the client does not review within 72 hours, Operations steps in."],
        ["Template", `${d.blueprintTitle ?? ""} (${d.blueprintCode})`],
      ]);
      if (d.tranches.length) {
        w.h3("Tranches (PayPal holds)");
        w.table([{ header: "Tranche", width: 0.16 }, { header: "Days", width: 0.24 }, { header: "Amount", width: 0.3, align: "right" }, { header: "State", width: 0.3 }],
          d.tranches.map((t) => [`T${t.idx}`, `day ${t.startDay} to ${t.endDay}`, money(t.amountCents), t.state.toLowerCase().replace(/_/g, " ")]));
      }

      w.h2("Milestones");
      const ms = d.milestones;
      w.table(
        [{ header: "Code", width: 0.1 }, { header: "Milestone", width: 0.36 }, { header: "Type", width: 0.1 }, { header: "Day", width: 0.07, align: "right" }, { header: "Share", width: 0.1, align: "right" }, { header: "Amount", width: 0.15, align: "right" }, { header: "Status", width: 0.12 }],
        ms.map((m) => [m.code, `${m.title}${m.origin === "CUSTOM" ? " (added in negotiation)" : ""}`, m.type === "PAY" ? "Payment" : "Gate", String(m.day), m.type === "PAY" ? pct(m.bps) : "—", m.type === "PAY" ? money(m.amountCents) : "—", m.active ? `T${m.tranche}` : "Removed"]),
      );
      const pay = ms.filter((m) => m.active);
      if (pay.length) {
        w.h3("Proof, lock and dispute rules");
        for (const m of pay) {
          w.room(60);
          w.p(`${m.code} · ${m.title}`, { bold: true, size: 9 });
          w.p(`Proof: ${m.artifacts || "as described"}${m.criteria.length ? `. Accepted when: ${m.criteria.join("; ")}` : ""}`, { size: 8.5 });
          w.p(`Lock rule: ${m.lockRule || "—"} · Dispute rule: ${m.disputeRule || "—"}`, { size: 8.5, muted: true });
        }
      }

      w.h2("Clauses");
      for (const [cat, label] of [["SYSTEM", "System clauses (in every contract; cannot be switched off)"], ["BASELINE", "Template clauses"], ["CUSTOM", "Clauses added by the parties"]] as const) {
        const list = d.clauses.filter((c) => c.category === cat);
        if (!list.length) continue;
        w.h3(label);
        for (const c of list) {
          w.room(40);
          w.p(`${c.code} · ${c.title}${c.active ? "" : " (switched off in negotiation)"}`, { bold: true, size: 9 });
          w.p(c.body, { size: 8.5, muted: !c.active });
        }
      }

      const extra = Object.entries(d.extraTerms);
      if (extra.length) {
        w.h2("Other signed terms");
        w.kv(extra.map(([k, v]) => [k, terms(v)]));
      }

      w.h2("Signatures");
      w.table(
        [{ header: "Role", width: 0.12 }, { header: "Signer", width: 0.22 }, { header: "Revision", width: 0.1, align: "right" }, { header: "Hash signed", width: 0.22 }, { header: "MFA", width: 0.08 }, { header: "Signed at", width: 0.26 }],
        d.signatures.map((s) => [s.role === "client" ? "Client" : "Provider", s.name, String(s.revNo), short(s.hash, 20), s.mfa ? "Yes" : "No", `${fmtIso(s.at)}${s.voidedAtRev !== null ? ` (void: contract changed at rev ${s.voidedAtRev})` : ""}`]),
      );

      w.h2("Integrity");
      if (d.revision) {
        const ok = d.revision.recomputed === d.revision.hash;
        w.kv([
          ["Revision", `${d.revision.revNo} (sealed ${fmtIso(d.revision.createdAt)})`],
          ["Canonical hash (SHA-256)", d.revision.hash],
          ["Recomputed now", `${d.revision.recomputed} ${ok ? "(matches)" : "(DOES NOT MATCH — report this to PaySettle)"}`],
        ], 160);
        w.p("Both signatures bind to this hash. The canonical JSON is attached to this PDF (canonical.json): sort the keys, remove whitespace, compute SHA-256, and compare. Any change to a milestone, clause or amount creates a new revision and voids earlier signatures.", { muted: true, size: 8.5 });
      } else w.p("No sealed revision yet, so there is no hash to check.", { muted: true });
      w.p(`Generated ${fmtIso(d.generatedAt)} for ${pdfText(d.generatedFor)}. PaySettle records evidence and approvals; PayPal holds and moves the money, and PayPal's own buyer and seller programmes still apply.`, { muted: true, size: 8 });

      if (d.canonicalJson) {
        try { w.doc.file(Buffer.from(d.canonicalJson, "utf8"), { name: "canonical.json", type: "application/json", description: `Canonical contract JSON, revision ${d.revision?.revNo}` }); }
        catch { /* attachments are optional; the hash above is still printed */ }
      }
    },
  );
}
