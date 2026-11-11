"use client";
/**
 * F5.01 F5.04 F3.11 — custom AG Grid cell renderers for PaySettle: money in cents, state chips (global .state classes),
 * hash shortener with a copy button and chain badge, invariant ✓/✗, highlighted plane differences, links and chips.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CustomCellRendererProps, CustomNoRowsOverlayProps } from "ag-grid-react";
import { fmtDate } from "@/components/console/format";
import { bpsText, isHash, isObj, KIND, COUNT, money, shortHash, signedMoney, stateChip, textOf, type CellValue, type HashStatus } from "./format";

export type ColType = "text" | "number" | "money" | "bps" | "date" | "state" | "chip" | "link" | "code" | "hash" | "check" | "diff";
export interface CellParams { type: ColType; currency?: string; labelColumn?: boolean }

const BADGE: Record<HashStatus, { b: string; label: string; title: string }> = {
  verified: { b: "ok", label: "Verified", title: "Recomputed by the last full chain check and linked to the entry before it." },
  linked: { b: "plain", label: "Linked", title: "Its previous-hash matches the entry before it on this page. Run Verify chain to recompute every hash." },
  broken: { b: "danger", label: "Broken", title: "At or after the entry where the chain check failed." },
  unchecked: { b: "none", label: "Unchecked", title: "Not covered by a chain check yet." },
};

function HashCell({ v }: { v: { hash: string; prev?: string | null; status?: HashStatus } }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(t); }, [copied]);
  const badge = v.status ? BADGE[v.status] : null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(v.hash); setCopied(true); } catch { /* clipboard blocked: the title still shows the full hash */ }
  };
  return (
    <span className="ps-hash">
      {v.prev !== undefined && v.prev !== null && <span className="ps-hash-prev" title={`Previous hash ${v.prev}`} aria-hidden="true">{shortHash(v.prev, 6)} →</span>}
      <code className="cx-code" title={v.hash}>{shortHash(v.hash, 10)}</code>
      <button type="button" className="ps-copy" onClick={copy} aria-label={copied ? "Hash copied" : `Copy full hash ${shortHash(v.hash, 10)}`} title={copied ? "Copied" : "Copy full hash"}>
        {copied ? "✓" : "⧉"}
      </button>
      {badge && <span className="chip" data-b={badge.b} title={badge.title}>{badge.label}</span>}
    </span>
  );
}

/** One renderer for every PaySettle column type; the type comes from cellRendererParams. */
export function PsCell(p: CustomCellRendererProps & CellParams) {
  const v = p.value as CellValue;
  const data = (p.data ?? {}) as Record<string, CellValue>;
  const kind = data[KIND];
  if (p.labelColumn && (kind === "subtotal" || kind === "total")) {
    const n = Number(data[COUNT] ?? 0);
    return <span className="ps-sumlabel">{textOf(v)}{n ? <span className="muted"> · {n} {n === 1 ? "row" : "rows"}</span> : null}</span>;
  }
  if (v === null || v === undefined || v === "") return kind ? null : <span className="muted" aria-label="none">—</span>;
  switch (p.type) {
    case "money": return <span className="money tnum">{money(v, p.currency)}</span>;
    case "diff": {
      const n = Number(v);
      if (n === 0) return <span className="ps-diff-ok tnum" aria-label="no difference">✓ {money(0, p.currency)}</span>;
      return <span className="tnum" aria-label={`difference ${signedMoney(n, p.currency)}`}>{signedMoney(n, p.currency)}</span>;
    }
    case "bps": return <span className="tnum">{bpsText(v)}</span>;
    case "number": return <span className="tnum">{Number(v).toLocaleString("en-US")}</span>;
    case "date": return <time dateTime={String(v)} className="tnum">{fmtDate(String(v))}</time>;
    case "state": { const s = stateChip(String(v)); return <span className={s.cls}>{s.label}</span>; }
    case "code": return <code className="cx-code">{String(v)}</code>;
    case "check": {
      const ok = v === true || v === "ok" || v === "✓";
      return <span className={ok ? "ps-check ok" : "ps-check bad"} role="img" aria-label={ok ? "balanced" : "not balanced"}>{ok ? "✓" : "✗"}</span>;
    }
    case "hash": return isHash(v) ? <HashCell v={v} /> : <HashCell v={{ hash: String(v) }} />;
    case "chip": return isObj(v) && "tone" in v ? <span className="chip" data-b={v.tone ?? "plain"}>{v.label}</span> : <span className="chip" data-b="plain">{textOf(v)}</span>;
    case "link": return isObj(v) && "href" in v ? <Link href={v.href}>{v.label}</Link> : <>{textOf(v)}</>;
    default: return <>{textOf(v)}</>;
  }
}

export function EmptyOverlay(p: CustomNoRowsOverlayProps & { text: string }) {
  return <div className="ps-empty" role="status"><b>{p.text}</b></div>;
}
