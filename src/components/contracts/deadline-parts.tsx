/**
 * F3.07 F3.08 + red team 17 — small display pieces: the published risk formula, the on-time badge and the
 * adjustment line ("Base $900.00 · −$4.50 late deduction (back to the client) · released $895.50").
 */
import { formatCents } from "@/lib/money";
import { RISK_FORMULA } from "@/lib/policy";
import { timingLabel, type Timing } from "@/lib/deadline";
import "@/styles/deadline.css";

/** Red team 17: the score formula with this contract's parts filled in (a disclosure, readable by keyboard and screen readers). */
export function RiskFormula({ score, parts }: { score: number; parts: Record<string, number> }) {
  return (
    <details className="risk-formula">
      <summary>How this score is computed</summary>
      <p className="small muted">score = round(100 × Σ weight × part); each part is between 0 and 1.</p>
      <ol>
        {RISK_FORMULA.map((f) => (
          <li key={f.key}><b>{f.label}</b> — weight {f.weight.toFixed(2)} × part {(parts[f.key] ?? 0).toFixed(2)} = <code>{(100 * f.weight * (parts[f.key] ?? 0)).toFixed(1)}</code><br /><span className="muted">{f.how}</span></li>
        ))}
      </ol>
      <p className="small">Total: <b>{score}</b>.</p>
    </details>
  );
}

export function TimingBadge({ timing, daysLate, daysEarly, provisional }: { timing: Timing; daysLate: number; daysEarly: number; provisional?: boolean }) {
  return <span className="dl-badge" data-t={timing}>{timingLabel({ timing, daysLate, daysEarly })}{provisional ? " (if approved now)" : ""}</span>;
}

export function AdjustmentLine({ a, currency = "USD" }: { a: { timing: Timing; daysLate: number; excusedDays: number; countedDays: number; daysEarly: number; baseCents: number; deductionCents: number; bonusCents: number }; currency?: string }) {
  const released = a.baseCents - a.deductionCents + a.bonusCents;
  if (!a.deductionCents && !a.bonusCents) {
    const why = a.timing === "LATE" ? ` ${a.daysLate} day${a.daysLate === 1 ? "" : "s"} late${a.excusedDays ? `, ${a.excusedDays} excused` : ""}; inside the grace days, so nothing is deducted.` : a.timing === "EARLY" ? " Early, but no bonus applies." : "";
    return <span className="dl-adj">No deadline adjustment.{why}</span>;
  }
  return (
    <span className="dl-adj">
      Base {formatCents(a.baseCents, currency)}
      {a.deductionCents > 0 && <> · <b>−{formatCents(a.deductionCents, currency)}</b> late deduction ({a.countedDays} counted day{a.countedDays === 1 ? "" : "s"}{a.excusedDays ? `, ${a.excusedDays} excused` : ""}), back to the client</>}
      {a.bonusCents > 0 && <> · <b>+{formatCents(a.bonusCents, currency)}</b> early bonus from the pool</>}
      {" "}· released {formatCents(released, currency)}
    </span>
  );
}
