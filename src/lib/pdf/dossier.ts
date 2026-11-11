/**
 * F4.10 evidence dossier PDF sent to PayPal with a representment: signed contract, approvals with time, evidence roots
 * and file hashes, releases, timeline. The dossier JSON is attached so its SHA-256 can be checked. Pure rendering;
 * the dossier comes from src/server/representment/dossier.ts (typed structurally here to keep lib free of server code).
 */
import { formatCents } from "@/lib/money";
import { fmtIso, renderPdf, short } from "./doc";

export interface DossierLike {
  disputeId: string; reason: string | null; asOf: string;
  contract: { id: string; title: string; blueprint: string; currency: string; totalCents: number; feeBps: number; rail: string; revNo: number | null; canonicalHash: string | null; hashVerified: boolean };
  parties: { client: string; provider: string | null };
  signatures: { role: string; signer: string; revNo: number; hash: string; mfa: boolean; at: string }[];
  tranches: { id: string; idx: number; amountCents: number; state: string; heldAt: string | null; orderId: string | null; authorizationId: string | null; captureId: string | null }[];
  milestones: {
    code: string; title: string; type: string; amountCents: number; state: string; targetDay: number;
    evidence: { attempt: number; rootHash: string; submittedAt: string; files: { name: string; kind: string; size: number; sha256: string }[] }[];
    approvals: { decision: string; at: string; rootHash: string; by: string; mfa: string | null; signatureFingerprint: string | null }[];
    releases: { kind: string; grossCents: number; feeCents: number; netCents: number; status: string; at: string; paypalRef: string | null; approvalFingerprint: string }[];
  }[];
  timeline: { at: string; action: string; target: string; role: string | null }[];
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const human = (a: string) => a.replace(/[._]/g, " ");

export async function dossierPdf(d: DossierLike, hash: string, dossierJson: string): Promise<Buffer> {
  const m = (c: number) => formatCents(c, d.contract.currency);
  return renderPdf(
    { title: `PaySettle evidence dossier — PayPal dispute ${d.disputeId}`, subject: "Signed contract, approvals and evidence hashes for a PayPal dispute", keywords: `PaySettle, dispute, ${d.disputeId}, ${d.contract.id}` },
    `PaySettle dossier · dispute ${d.disputeId} · contract ${d.contract.id} · SHA-256 ${hash.slice(0, 16)}`,
    (w) => {
      w.title("Evidence dossier", `PayPal dispute ${d.disputeId}${d.reason ? ` · reason ${d.reason.replace(/_/g, " ").toLowerCase()}` : ""} · facts recorded up to ${fmtIso(d.asOf)}`);
      w.notice(`PaySettle records the contract, the evidence and the client's approvals; PayPal holds and moves the money. Every release below happened only after the client's signed approval of the evidence (or the review rule both parties signed).`);

      w.h2("Contract");
      w.kv([
        ["Contract", `${d.contract.title} (${d.contract.id})`],
        ["Template", d.contract.blueprint],
        ["Total", `${m(d.contract.totalCents)} · rail ${d.contract.rail}`],
        ["Client", d.parties.client],
        ["Provider", d.parties.provider ?? "—"],
        ["Signed revision", d.contract.revNo === null ? "not sealed" : String(d.contract.revNo)],
        ["Canonical hash", `${d.contract.canonicalHash ?? "—"}${d.contract.canonicalHash ? (d.contract.hashVerified ? " (recomputed: matches)" : " (recomputed: does not match)") : ""}`],
      ], 120);
      w.h3("Signatures");
      w.table([{ header: "Role", width: 0.13 }, { header: "Signer", width: 0.25 }, { header: "Rev", width: 0.07, align: "right" }, { header: "Hash signed", width: 0.25 }, { header: "MFA", width: 0.07 }, { header: "Signed at", width: 0.23 }],
        d.signatures.map((s) => [s.role, s.signer, String(s.revNo), short(s.hash, 20), s.mfa ? "Yes" : "No", fmtIso(s.at)]));

      w.h2("Disputed payment");
      w.table([{ header: "Tranche", width: 0.1 }, { header: "Amount", width: 0.15, align: "right" }, { header: "State", width: 0.15 }, { header: "Held since", width: 0.22 }, { header: "PayPal references", width: 0.38 }],
        d.tranches.map((t) => [`T${t.idx}`, m(t.amountCents), t.state.toLowerCase().replace(/_/g, " "), fmtIso(t.heldAt), [t.orderId && `order ${t.orderId}`, t.authorizationId && `auth ${t.authorizationId}`, t.captureId && `capture ${t.captureId}`].filter(Boolean).join("\n") || "—"]));

      w.h2("Milestones, evidence and approvals");
      for (const ms of d.milestones) {
        w.h3(`${ms.code} · ${ms.title} · ${ms.type === "PAY" ? m(ms.amountCents) : "gate"} · ${ms.state.toLowerCase().replace(/_/g, " ")}`);
        if (!ms.evidence.length && !ms.approvals.length && !ms.releases.length) { w.p("No evidence submitted yet.", { muted: true, size: 8.5 }); continue; }
        for (const e of ms.evidence) {
          w.p(`Evidence attempt ${e.attempt}, submitted ${fmtIso(e.submittedAt)} · root ${e.rootHash}`, { size: 8.5 });
          if (e.files.length) w.table([{ header: "File", width: 0.34 }, { header: "Kind", width: 0.1 }, { header: "Size", width: 0.1, align: "right" }, { header: "SHA-256", width: 0.46 }], e.files.map((f) => [f.name, f.kind, kb(f.size), f.sha256]), { size: 7.5 });
        }
        if (ms.approvals.length) w.table([{ header: "Approval", width: 0.2 }, { header: "By", width: 0.25 }, { header: "At", width: 0.22 }, { header: "Evidence root approved", width: 0.33 }],
          ms.approvals.map((a) => [a.decision === "DEEMED_APPROVED" ? "Deemed approved (signed rule)" : "Client approved", `${a.by}${a.mfa ? ` · MFA ${a.mfa}` : ""}`, fmtIso(a.at), short(a.rootHash, 28)]), { size: 7.5 });
        if (ms.releases.length) w.table([{ header: "Release", width: 0.16 }, { header: "Gross", width: 0.14, align: "right" }, { header: "Fee", width: 0.12, align: "right" }, { header: "Net", width: 0.14, align: "right" }, { header: "Status", width: 0.12 }, { header: "At", width: 0.17 }, { header: "PayPal ref", width: 0.15 }],
          ms.releases.map((r) => [r.kind === "VERDICT" ? "Mediator verdict" : "Milestone", m(r.grossCents), m(r.feeCents), m(r.netCents), r.status.toLowerCase().replace(/_/g, " "), fmtIso(r.at), r.paypalRef ?? "—"]), { size: 7.5 });
      }

      w.h2("Timeline");
      w.table([{ header: "When (UTC)", width: 0.24 }, { header: "What happened", width: 0.44 }, { header: "By", width: 0.12 }, { header: "Record", width: 0.2 }],
        d.timeline.map((t) => [fmtIso(t.at), human(t.action), t.role ?? "system", short(t.target, 18)]), { size: 7.5 });

      w.h2("Integrity");
      w.kv([["Dossier SHA-256", hash]], 110);
      w.p("The dossier JSON is attached to this PDF (dossier.json). Its canonical form (sorted keys, no whitespace) hashes to the value above. Evidence files are identified by SHA-256; PaySettle keeps the original files unchanged and can provide them on request.", { muted: true, size: 8.5 });
      try { w.doc.file(Buffer.from(dossierJson, "utf8"), { name: "dossier.json", type: "application/json", description: "Canonical dossier JSON" }); }
      catch { /* attachment optional */ }
    },
  );
}
