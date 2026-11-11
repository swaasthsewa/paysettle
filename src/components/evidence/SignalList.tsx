/** F3.04 signals list: ok / warn / fail with colour plus a word (never colour alone). Server- and client-safe. */
import type { Signal } from "@/server/evidence/spec";

const WORD = { ok: "OK", warn: "Check", fail: "Missing" } as const;
const CHIP = { ok: "ok", warn: "warn", fail: "danger" } as const;

export function SignalList({ signals, title }: { signals: Signal[]; title?: string }) {
  if (!signals.length) return <p className="muted small">No checks apply yet.</p>;
  return (
    <div className="stack">
      {title && <h3 className="small">{title}</h3>}
      <ul className="ev-signals">
        {signals.map((s, i) => (
          <li key={`${s.code}-${i}`} data-level={s.level}>
            <span className="chip" data-b={CHIP[s.level]}>{WORD[s.level]}</span>
            <span className="ev-sig-code tnum">{s.code}</span>
            <span className="ev-sig-detail">{s.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
