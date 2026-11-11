"use client";
/**
 * Console data grid (F5.01, F5.02, F5.04, F5.10, F3.11) on AG Grid Community (MIT, no licence key), themed
 * with the PaySettle tokens (src/components/grid/theme.ts) and PaySettle cell renderers (src/components/grid/cells.tsx).
 *
 * Props are unchanged from the earlier table, so server components keep passing plain, serialisable rows:
 * rowData, columnDefs { field, headerName, type, sortable, filter }, getRowId, pagination, paginationPageSize.
 * Added (all optional): column groups, pinned totals for money columns, a client-side "Group by" with subtotal rows
 * (Community has no row grouping), CSV export, a column chooser, density, and the column layout kept in localStorage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ColGroupDef, ColumnMovedEvent, ColumnResizedEvent, GridApi, GridReadyEvent, IRowNode, PostSortRowsParams, ProcessCellForExportParams, RowClassParams } from "ag-grid-community";
import { psTheme, psThemeCompact } from "@/components/grid/theme";
import { PsCell, type CellParams, type ColType } from "@/components/grid/cells";
import {
  centsToDecimal, compareCells, COUNT, GROUP, groupWithSubtotals, humanize, isHash, isMoneyType, isNumericType, KIND, matchesPicks, matchesQuick,
  regroupSorted, sumColumns, textOf, type CellValue, type Row,
} from "@/components/grid/format";
import "@/styles/console.css";
import "@/styles/grid.css";

export type { CellValue, Tone } from "@/components/grid/format";

export interface ColumnDef {
  field: string;
  headerName: string;
  /** text (default) · number · money (integer cents) · diff (cents, highlighted when not zero) · bps · date (ISO) · state ·
   *  chip ({label,tone}) · link ({href,label}) · code · hash (string or {hash, prev?, status?}) · check (true/false → ✓/✗) */
  type?: ColType;
  sortable?: boolean;
  /** true: a pick-list of the column's distinct values in the toolbar */
  filter?: boolean;
  align?: "left" | "right";
  width?: number;
  /** Columns that share a group name (and sit next to each other) get one group header, e.g. "B · Ledger". */
  group?: string;
  pinned?: "left" | "right";
  /** Money columns are added up in the pinned totals row unless this is false. */
  total?: boolean;
  /** Start hidden (the person can show it from Columns). */
  hide?: boolean;
  tooltip?: string;
}
export interface DataTableProps {
  rowData: Record<string, CellValue>[];
  columnDefs: ColumnDef[];
  getRowId?: string;
  caption: string;
  quickFilter?: boolean;
  pagination?: boolean;
  paginationPageSize?: number;
  emptyText?: string;
  initialSort?: { field: string; dir: "asc" | "desc" };
  /** Pinned totals row for money columns (default: on when there are money columns and more than one row). */
  totals?: boolean;
  /** CSV file name stem (default: from the caption). */
  exportName?: string;
  /** localStorage key for the column layout (default: from the caption). */
  persistKey?: string;
  /** Offer "Group by <label>": member rows gathered per value of `field`, each group closed by a subtotal row. `carry`
   *  copies those fields from the group's first row onto its subtotal (e.g. the tranche's invariant ✓/✗). */
  groupBy?: { field: string; labelField?: string; label: string; carry?: string[]; defaultOn?: boolean };
  /** Row field holding a tone (ok · warn · risk · danger) that tints the whole row. */
  rowToneField?: string;
  currency?: string;
  /** Height in px when the table scrolls inside itself (long tables without pagination). */
  height?: number;
}

const DENSITY_KEY = "ps.grid.density";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "table";
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const LABEL_TYPES = new Set<ColType | undefined>([undefined, "text", "link", "code", "chip", "state"]);

function csvValue(v: CellValue, type: ColType | undefined): string {
  if (v === null || v === undefined) return "";
  if (type === "money" || type === "diff") return typeof v === "number" ? centsToDecimal(v) : textOf(v);
  if (type === "bps" && typeof v === "number") return (v / 100).toFixed(2) + "%";
  if (type === "check") return v === true ? "balanced" : "not balanced";
  if (isHash(v)) return v.hash;
  return textOf(v);
}

export function DataTable({
  rowData, columnDefs, getRowId, caption, quickFilter = true, pagination = false, paginationPageSize = 25, emptyText = "Nothing to show yet.",
  initialSort, totals, exportName, persistKey, groupBy, rowToneField, currency = "USD", height = 560,
}: DataTableProps) {
  const apiRef = useRef<GridApi | null>(null);
  const popRef = useRef<HTMLDetailsElement>(null);
  const storeKey = `ps.grid.v1.${slug(persistKey ?? caption)}`;
  const [q, setQ] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [grouped, setGrouped] = useState(!!groupBy?.defaultOn);
  const [compact, setCompact] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columnDefs.filter((c) => c.hide).map((c) => c.field)));
  useEffect(() => {
    /* close the column chooser on a click outside it */
    const close = (e: MouseEvent) => { const d = popRef.current; if (d?.open && !d.contains(e.target as Node)) d.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const fields = useMemo(() => columnDefs.map((c) => c.field), [columnDefs]);
  const labelField = useMemo(() => (columnDefs.find((c) => LABEL_TYPES.has(c.type)) ?? columnDefs[0])?.field ?? "", [columnDefs]);
  const moneyFields = useMemo(() => columnDefs.filter((c) => isMoneyType(c.type) && c.total !== false).map((c) => c.field), [columnDefs]);
  const options = useMemo(
    () => Object.fromEntries(columnDefs.filter((c) => c.filter).map((c) => [c.field, [...new Set(rowData.map((r) => textOf(r[c.field])).filter(Boolean))].sort()])),
    [rowData, columnDefs],
  );

  const filtered = useMemo(() => rowData.filter((r) => matchesQuick(r, fields, q) && matchesPicks(r, picks)), [rowData, fields, q, picks]);
  const display = useMemo<Row[]>(() => {
    if (!grouped || !groupBy) return filtered;
    return groupWithSubtotals(filtered, {
      field: groupBy.field, labelField: groupBy.labelField, labelInto: labelField, sumFields: moneyFields,
      extra: (_k, members) => Object.fromEntries((groupBy.carry ?? []).map((f) => [f, members[0]?.[f]])),
    });
  }, [filtered, grouped, groupBy, labelField, moneyFields]);
  const showTotals = (totals ?? true) && moneyFields.length > 0 && filtered.length > 1;
  const pinnedBottom = useMemo(
    () => (showTotals ? [{ ...sumColumns(filtered, moneyFields), [labelField]: "Total", [KIND]: "total", [COUNT]: filtered.length, __id: "__total" }] : undefined),
    [showTotals, filtered, moneyFields, labelField],
  );

  const colDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const toCol = (c: ColumnDef): ColDef => {
      const numeric = c.align === "right" || isNumericType(c.type);
      const params: CellParams = { type: c.type ?? "text", currency, labelColumn: c.field === labelField };
      return {
        colId: c.field, field: c.field, headerName: c.headerName, headerTooltip: c.tooltip,
        sortable: c.sortable !== false, resizable: true, filter: false,
        initialSort: initialSort?.field === c.field ? initialSort.dir : undefined, initialHide: c.hide, initialPinned: c.pinned,
        ...(c.width ? { initialWidth: c.width, minWidth: Math.min(c.width, 64) } : { initialFlex: c.type === "hash" ? 1.6 : c.field === labelField ? 1.4 : 1, minWidth: c.type === "hash" ? 230 : numeric ? 110 : 120 }),
        cellClass: numeric ? "ag-right-aligned-cell" : undefined, headerClass: numeric ? "ag-right-aligned-header" : undefined,
        cellRenderer: PsCell, cellRendererParams: params,
        comparator: (a: CellValue, b: CellValue, _na: IRowNode, _nb: IRowNode, desc: boolean) => compareCells(a, b, c.type, desc),
        cellClassRules: c.type === "diff" ? { "ps-diff-bad": (p: { value: unknown; node: IRowNode }) => typeof p.value === "number" && p.value !== 0 } : undefined,
        tooltipValueGetter: c.type === "text" || c.type === undefined ? (p) => { const t = textOf(p.value as CellValue); return t.length > 36 ? t : undefined; } : undefined,
      };
    };
    const out: (ColDef | ColGroupDef)[] = [];
    for (const c of columnDefs) {
      const last = out[out.length - 1] as ColGroupDef | undefined;
      if (c.group && last && "children" in last && last.headerName === c.group) last.children.push(toCol(c));
      else if (c.group) out.push({ headerName: c.group, groupId: `g:${c.group}`, headerClass: "ps-colgroup", marryChildren: true, children: [toCol(c)] });
      else out.push(toCol(c));
    }
    return out;
  }, [columnDefs, currency, labelField, initialSort]);

  const syncHidden = useCallback((api: GridApi) => {
    setHidden(new Set(api.getColumnState().filter((s) => s.hide).map((s) => s.colId)));
  }, []);
  const save = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    try { localStorage.setItem(storeKey, JSON.stringify(api.getColumnState())); } catch { /* storage full or blocked: layout just isn't kept */ }
  }, [storeKey]);
  const onGridReady = useCallback((e: GridReadyEvent) => {
    apiRef.current = e.api;
    try {
      setCompact(localStorage.getItem(DENSITY_KEY) === "compact");
      const saved = localStorage.getItem(storeKey);
      if (saved) e.api.applyColumnState({ state: JSON.parse(saved), applyOrder: true });
    } catch { /* corrupt or blocked storage: keep the default layout */ }
    syncHidden(e.api);
  }, [storeKey, syncHidden]);
  const resetLayout = () => {
    const api = apiRef.current;
    if (!api) return;
    try { localStorage.removeItem(storeKey); } catch { /* ignore */ }
    api.resetColumnState();
    syncHidden(api);
  };
  const toggleColumn = (field: string) => { apiRef.current?.setColumnsVisible([field], hidden.has(field)); };
  const setDensity = (c: boolean) => { setCompact(c); try { localStorage.setItem(DENSITY_KEY, c ? "compact" : "comfortable"); } catch { /* ignore */ } };
  const exportCsv = () => {
    apiRef.current?.exportDataAsCsv({
      fileName: `${slug(exportName ?? caption)}-${new Date().toISOString().slice(0, 10)}.csv`,
      processCellCallback: (p: ProcessCellForExportParams) => csvValue(p.value as CellValue, (p.column.getColDef().cellRendererParams as CellParams | undefined)?.type),
    });
  };

  /* rows only carry a group key while "Group by" is on; without one every row is left where the grid sorted it */
  const postSortRows = useCallback((p: PostSortRowsParams) => {
    regroupSorted(p.nodes, (n) => (n.data?.[GROUP] as string | undefined), (n) => n.data?.[KIND] === "subtotal");
  }, []);
  const getRowClass = useCallback((p: RowClassParams) => {
    const d = (p.data ?? {}) as Row;
    const cls: string[] = [];
    if (d[KIND] === "subtotal") cls.push("ps-row-sub");
    if (d[KIND] === "total") cls.push("ps-row-total");
    const tone = rowToneField ? d[rowToneField] : undefined;
    if (typeof tone === "string" && tone) cls.push(`ps-tone-${tone}`);
    return cls;
  }, [rowToneField]);
  const rowId = useMemo(() => (getRowId ? (p: { data: Row }) => String(p.data.__id ?? textOf(p.data[getRowId])) : undefined), [getRowId]);

  const members = filtered.length;
  const autoHeight = pagination || display.length <= 15;
  const visibleCount = columnDefs.length - hidden.size;
  const overlay = `<span class="ps-empty">${escapeHtml(rowData.length ? "Nothing matches the filter." : emptyText)}</span>`;

  return (
    <section className="ps-grid" aria-label={caption}>
      <div className="ps-gtools" role="group" aria-label={`${caption}: table tools`}>
        {quickFilter && (
          <label className="ps-q" role="search">
            <span className="sr-only">Search {caption}</span>
            <span className="ps-q-icon" aria-hidden="true">⌕</span>
            <input className="input" type="search" placeholder="Search rows" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
        {columnDefs.filter((c) => c.filter).map((c) => (
          <label key={c.field} className="ps-pick">
            <span className="sr-only">{c.headerName}</span>
            <select className="input" value={picks[c.field] ?? ""} onChange={(e) => setPicks((p) => ({ ...p, [c.field]: e.target.value }))}>
              <option value="">{c.headerName}: all</option>
              {options[c.field]?.map((o) => <option key={o} value={o}>{c.type === "state" ? humanize(o) : o}</option>)}
            </select>
          </label>
        ))}
        {groupBy && (
          <label className="ps-switch">
            <input type="checkbox" role="switch" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
            <span aria-hidden="true" className="ps-switch-ui" />
            <span>Group by {groupBy.label}</span>
          </label>
        )}
        <span className="sp" />
        <span className="small muted ps-count" aria-live="polite">{members === rowData.length ? `${members} ${members === 1 ? "row" : "rows"}` : `${members} of ${rowData.length} rows`}</span>
        <details ref={popRef} className="ps-pop" onKeyDown={(e) => { if (e.key !== "Escape") return; const d = e.currentTarget as HTMLDetailsElement; d.open = false; d.querySelector("summary")?.focus(); }}>
          <summary className="btn btn-sm btn-gh">Columns</summary>
          <div className="ps-pop-body" role="group" aria-label={`Columns shown in ${caption}`}>
            {columnDefs.map((c) => {
              const on = !hidden.has(c.field);
              return (
                <label key={c.field} className="ps-pop-item">
                  <input type="checkbox" checked={on} disabled={on && visibleCount <= 1} onChange={() => toggleColumn(c.field)} /> {c.headerName}
                </label>
              );
            })}
            <hr />
            <div className="ps-pop-item" role="radiogroup" aria-label="Row density">
              <label><input type="radio" name={`${storeKey}-density`} checked={!compact} onChange={() => setDensity(false)} /> Comfortable</label>
              <label><input type="radio" name={`${storeKey}-density`} checked={compact} onChange={() => setDensity(true)} /> Compact</label>
            </div>
            <button type="button" className="btn btn-sm btn-gh" onClick={resetLayout}>Reset layout</button>
          </div>
        </details>
        <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={members === 0}>Export CSV</button>
      </div>
      <div className="ps-grid-body" style={autoHeight ? undefined : { height }}>
        <AgGridReact
          theme={compact ? psThemeCompact : psTheme}
          rowData={display}
          columnDefs={colDefs}
          getRowId={rowId}
          pinnedBottomRowData={pinnedBottom}
          domLayout={autoHeight ? "autoHeight" : "normal"}
          pagination={pagination}
          paginationPageSize={paginationPageSize}
          paginationPageSizeSelector={pagination ? [...new Set([10, 25, 50, 100, paginationPageSize])].sort((a, b) => a - b) : false}
          postSortRows={postSortRows}
          getRowClass={getRowClass}
          overlayNoRowsTemplate={overlay}
          onGridReady={onGridReady}
          onSortChanged={save}
          onColumnMoved={(e: ColumnMovedEvent) => { if (e.finished && e.source === "uiColumnMoved") save(); }}
          onColumnResized={(e: ColumnResizedEvent) => { if (e.finished && e.source === "uiColumnResized") save(); }}
          onColumnVisible={() => { save(); if (apiRef.current) syncHidden(apiRef.current); }}
          onColumnPinned={save}
          enableCellTextSelection
          ensureDomOrder
          suppressDragLeaveHidesColumns
          tooltipShowDelay={400}
          animateRows
        />
      </div>
    </section>
  );
}
