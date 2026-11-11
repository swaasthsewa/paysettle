/**
 * F1.4 OCR assist · the advisory fields read from each licence (number, expiry, issuer), for Ops at review and for the
 * provider on their own onboarding page. Read-only: a suggestion with where each value came from (AI, the PDF text,
 * or the file name); Ops compares it with the document and decides. Server component, no client code.
 */
import type { LicenceRecord } from "@/lib/identity/provider";
import { licenceFlags } from "@/lib/identity/ocr";
import "@/styles/register.css";

const FROM = { ai: "AI, checked against the text", text: "document text", filename: "file name" } as const;

export function LicenceSuggestion({ licence, todayIso, audience = "ops" }: { licence: LicenceRecord; todayIso: string; audience?: "ops" | "provider" }) {
  const s = licence.suggest;
  if (!s) return <p className="small muted">{audience === "ops" ? "No suggested fields: the provider did not allow reading this file." : "Not read: you did not allow reading this file."}</p>;
  const has = Boolean(s.number || s.expiry || s.issuer);
  const flags = licenceFlags(s.expiry, todayIso);
  const src = (k: "number" | "expiry" | "issuer") => (s.sources[k] ? FROM[s.sources[k]!] : "");
  return (
    <div className="small" aria-label={`Suggested fields for ${licence.name}`}>
      <div className="row" style={{ gap: 6 }}>
        <span className="chip" data-b="plain">Suggestion · {s.model === "rules" ? "rule-based" : `AI (${s.model})`}</span>
        {flags.expired && <span className="chip" data-b="danger">Expiry date has passed</span>}
        {flags.expiresSoon && <span className="chip" data-b="warn">Expires within 30 days</span>}
        {s.injection && <span className="chip" data-b="warn">Text contained instructions; ignored</span>}
      </div>
      {has ? (
        <dl className="reg-ocr">
          <div><dt>Licence number</dt><dd>{s.number ?? "—"}{s.number && <small className="muted" style={{ display: "block", fontWeight: 400 }}>from {src("number")}</small>}</dd></div>
          <div><dt>Expiry</dt><dd>{s.expiry ?? "—"}{s.expiry && <small className="muted" style={{ display: "block", fontWeight: 400 }}>from {src("expiry")}</small>}</dd></div>
          <div><dt>Issuer</dt><dd>{s.issuer ?? "—"}{s.issuer && <small className="muted" style={{ display: "block", fontWeight: 400 }}>from {src("issuer")}</small>}</dd></div>
        </dl>
      ) : <p className="muted">Nothing could be read{s.textChars ? "" : " (no selectable text)"}; check the document by hand.</p>}
      {audience === "ops" && <p className="muted" style={{ marginTop: 4 }}>Advice only: compare with the document whose SHA-256 is <code>{licence.sha256.slice(0, 16)}{"…"}</code> before accepting.</p>}
    </div>
  );
}

/** Every licence of one provider with its suggestion: the block Ops sees in the identity auditor. */
export function LicenceSuggestions({ licences, todayIso }: { licences: LicenceRecord[]; todayIso: string }) {
  if (!licences.length) return <p className="small muted">No licence or registration documents on file.</p>;
  return (
    <ul className="reg-list">
      {licences.map((l) => (
        <li key={l.id} style={{ display: "block" }}>
          <b>{l.name}</b> <span className="muted small">· {l.review.toLowerCase()} · {(l.size / 1024).toFixed(0)} KB</span>
          <LicenceSuggestion licence={l} todayIso={todayIso} />
        </li>
      ))}
    </ul>
  );
}
