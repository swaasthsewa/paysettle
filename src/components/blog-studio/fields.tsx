"use client";
/**
 * Blog studio — small accessible form controls for the block inspector. Every control has a visible label tied to the
 * input, marks itself aria-invalid when the zod check for its path fails, and points aria-describedby at the error text.
 */
import { useId, useState, type ReactNode } from "react";
import { centsToDollars, dollarsToCents } from "./model";
import { formatCents } from "@/lib/money";

function Errs({ id, errs }: { id: string; errs: string[] }) {
  if (!errs.length) return null;
  return <p id={id} className="bs-err">{errs.join(" ")}</p>;
}
function describe(id: string, errs: string[], hint?: string) {
  const ids = [hint ? `${id}-hint` : "", errs.length ? `${id}-err` : ""].filter(Boolean).join(" ");
  return { "aria-invalid": errs.length ? true : undefined, "aria-describedby": ids || undefined } as const;
}

export function TextField({ label, value, onChange, max, errs = [], hint, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; max?: number; errs?: string[]; hint?: string; placeholder?: string; mono?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={`input${mono ? " bs-mono" : ""}`} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...describe(id, errs, hint)} />
      {hint && <span id={`${id}-hint`} className="small muted">{hint}{max ? ` · ${value.length}/${max}` : ""}</span>}
      <Errs id={`${id}-err`} errs={errs} />
    </div>
  );
}

export function AreaField({ label, value, onChange, max, rows = 4, errs = [], hint, mono }: { label: string; value: string; onChange: (v: string) => void; max?: number; rows?: number; errs?: string[]; hint?: string; mono?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} className={`input${mono ? " bs-mono" : ""}`} rows={rows} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} {...describe(id, errs, hint)} />
      {(hint || max) && <span id={`${id}-hint`} className="small muted">{hint}{hint && max ? " · " : ""}{max ? `${value.length}/${max}` : ""}</span>}
      <Errs id={`${id}-err`} errs={errs} />
    </div>
  );
}

export function IntField({ label, value, onChange, min, max, step = 1, errs = [], hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; errs?: string[]; hint?: string }) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); if (text !== String(value)) setText(String(value)); }
  const local = /^-?\d+$/.test(text) ? [] : ["Enter a whole number."];
  const all = [...local, ...errs];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input bs-num" inputMode="numeric" value={text} min={min} max={max} step={step}
        onChange={(e) => { setText(e.target.value); if (/^-?\d+$/.test(e.target.value)) onChange(Number(e.target.value)); }} {...describe(id, all, hint)} />
      {hint && <span id={`${id}-hint`} className="small muted">{hint}</span>}
      <Errs id={`${id}-err`} errs={all} />
    </div>
  );
}

/** Money as dollars in the form, integer cents in the block (P6). */
export function CentsField({ label, value, onChange, errs = [] }: { label: string; value: number; onChange: (c: number) => void; errs?: string[] }) {
  const id = useId();
  const [text, setText] = useState(centsToDollars(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); if (dollarsToCents(text) !== value) setText(centsToDollars(value)); }
  const parsed = dollarsToCents(text);
  const all = [...(parsed === null ? ["Enter an amount like 14500 or 14,500.00."] : []), ...errs];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="bs-money"><span aria-hidden="true">$</span>
        <input id={id} className="input bs-num" inputMode="decimal" value={text} onChange={(e) => { setText(e.target.value); const c = dollarsToCents(e.target.value); if (c !== null) onChange(c); }} {...describe(id, all, "x")} />
      </div>
      <span id={`${id}-hint`} className="small muted">{parsed !== null ? `${formatCents(parsed)} · stored as ${parsed.toLocaleString("en-US")} cents` : "Not a valid amount yet."}</span>
      <Errs id={`${id}-err`} errs={all} />
    </div>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, errs = [], hint }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; errs?: string[]; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as T)} {...describe(id, errs, hint)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span id={`${id}-hint`} className="small muted">{hint}</span>}
      <Errs id={`${id}-err`} errs={errs} />
    </div>
  );
}

export function CheckField({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="bs-check">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
      <label htmlFor={id}>{label}</label>
      {hint && <span id={`${id}-hint`} className="small muted">{hint}</span>}
    </div>
  );
}

/** A repeatable group (list items, stats, steps, FAQ rows, sources) with add / remove / reorder buttons. */
export function Repeat<T>({ legend, items, onChange, min = 0, max = 20, make, render, itemLabel, errs = [] }: {
  legend: string; items: T[]; onChange: (next: T[]) => void; min?: number; max?: number; make: () => T;
  render: (item: T, set: (v: T) => void, i: number) => ReactNode; itemLabel: (i: number) => string; errs?: string[];
}) {
  const set = (i: number, v: T) => onChange(items.map((x, j) => (j === i ? v : x)));
  const move = (i: number, d: -1 | 1) => { const n = [...items]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  return (
    <fieldset className="bs-repeat">
      <legend>{legend} <span className="muted small">({items.length}{max ? ` of up to ${max}` : ""})</span></legend>
      {errs.length > 0 && <p className="bs-err">{errs.join(" ")}</p>}
      {items.map((it, i) => (
        <div key={i} className="bs-repeat-item" role="group" aria-label={itemLabel(i)}>
          <div className="bs-repeat-head">
            <b className="small">{itemLabel(i)}</b>
            <span className="sp" />
            <button type="button" className="btn btn-sm btn-gh" aria-label={`Move ${itemLabel(i)} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="btn btn-sm btn-gh" aria-label={`Move ${itemLabel(i)} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="btn btn-sm btn-gh" aria-label={`Remove ${itemLabel(i)}`} disabled={items.length <= min} onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
          </div>
          {render(it, (v) => set(i, v), i)}
        </div>
      ))}
      <button type="button" className="btn btn-sm" disabled={items.length >= max} onClick={() => onChange([...items, make()])}>Add {legend.toLowerCase().replace(/s$/, "")}</button>
    </fieldset>
  );
}
