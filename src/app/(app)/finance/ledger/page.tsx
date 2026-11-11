/**
 * F3.11 Double-entry ledger: every entry with filters (contract, tranche, type), totals per account, and the invariant
 * per tranche (held = released + returned + remaining, cross-checked with releases and returns) shown as ✓ / ✗.
 * Tables are the AG Grid console grid (F5.01): group by tranche with subtotals, invariant column, CSV export.
 */
import Link from "next/link";
import { requireViewer } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { DataTable } from "@/components/console/DataTable";
import { invariants, ledgerView } from "@/server/money/queries";
import { isSeededExample, SEEDED_EXAMPLE_LABEL } from "@/server/control/demo-fixtures";
import "@/styles/money.css";

export const metadata = { title: "Ledger" };
const TYPES = ["HOLD", "RELEASE", "FEE", "VOID", "REFUND"];
/** Accounts that hold a tranche's money (paypal:hold:<tranche>, or hold:<tranche> on the mock rail). */
const isHold = (account: string) => /^(paypal:)?hold:/.test(account);

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireViewer(["finance", "admin", "ops", "judge"]);
  const sp = await searchParams;
  const f = { workspaceId: sp.contract || undefined, trancheId: sp.tranche || undefined, type: TYPES.includes(sp.type ?? "") ? sp.type : undefined, includeTest: sp.test === "1" };
  const [{ rows, accounts, contracts }, inv] = await Promise.all([ledgerView(f), invariants(f)]);
  const bad = inv.filter((i) => !i.ok).length;
  const badSeeded = inv.filter((i) => !i.ok && isSeededExample(i.trancheId)).length;
  const invOk = new Map(inv.map((i) => [i.trancheId, i.ok]));
  return (
    <>
      <div className="phead">
        <div><h1>Ledger</h1><p className="sub">Double-entry, integer cents. Each tranche must satisfy held = released + returned + remaining, and agree with the release and return records.</p></div>
        <div className="stats">
          <div className="hstat"><div className="v">{rows.length}</div><div className="l">entries shown</div></div>
          <div className="hstat"><div className={`v ${bad ? "inv-bad" : "inv-ok"}`}>{bad ? `${bad} ✗` : "✓"}</div><div className="l">{inv.length} tranche invariants{badSeeded ? ` · ${badSeeded === bad ? "all" : badSeeded} ✗ from the seeded example` : ""}</div></div>
        </div>
      </div>
      {badSeeded > 0 && <p className="c small" role="note"><b>{SEEDED_EXAMPLE_LABEL}.</b> The “Inventory dashboard” demo contract carries a duplicate release posting on purpose. Pick your own contract under Contract to see its tranches on their own.</p>}

      <form className="c money-filter" method="get" aria-label="Filter the ledger">
        <div className="field mf-contract"><label htmlFor="f-c">Contract</label>
          <select id="f-c" name="contract" defaultValue={f.workspaceId ?? ""}><option value="">All contracts</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></div>
        <div className="field mf-tranche"><label htmlFor="f-t">Tranche id</label><input id="f-t" name="tranche" type="text" defaultValue={f.trancheId ?? ""} placeholder="tr_…" /></div>
        <div className="field mf-type"><label htmlFor="f-y">Type</label>
          <select id="f-y" name="type" defaultValue={f.type ?? ""}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        <label className="mf-check small"><input type="checkbox" name="test" value="1" defaultChecked={f.includeTest} /> Include playground and test data</label>
        <div className="mf-actions">
          <button className="btn btn-sm" type="submit">Apply</button>
          <Link className="btn btn-gh btn-sm" href="/finance/ledger">Clear</Link>
        </div>
      </form>

      <div className="money-stack">
        <section className="c" aria-labelledby="inv-h">
          <h2 id="inv-h">Invariant per tranche</h2>
          <DataTable caption="Invariant per tranche" persistKey="ledger-invariants-v2" getRowId="id" quickFilter={inv.length > 8} emptyText="No funded tranches match."
            initialSort={{ field: "ok", dir: "asc" }}
            columnDefs={[
              { field: "ok", headerName: "Check", type: "check", width: 92 },
              { field: "tranche", headerName: "Contract · tranche", type: "link", width: 300 },
              { field: "state", headerName: "State", type: "state", filter: true, width: 230 },
              { field: "held", headerName: "Held", type: "money", group: "Where the money went" },
              { field: "released", headerName: "Released", type: "money", group: "Where the money went" },
              { field: "returned", headerName: "Returned", type: "money", group: "Where the money went" },
              { field: "remaining", headerName: "Remaining", type: "money", group: "Where the money went" },
              { field: "issues", headerName: "Failing checks", hide: !bad },
              { field: "example", headerName: "Example", width: 200, hide: !badSeeded },
            ]}
            rowData={inv.map((i) => ({
              id: i.trancheId, ok: i.ok, tranche: { href: `/finance/ledger?tranche=${i.trancheId}${f.includeTest ? "&test=1" : ""}`, label: `${i.title} · ${i.idx}` }, state: i.state,
              held: i.balance.held, released: i.balance.released, returned: i.balance.returned, remaining: i.balance.remaining,
              issues: i.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join(" · ") || null,
              example: isSeededExample(i.trancheId) ? "Seeded example" : null,
            }))} />
        </section>
        <section className="c" aria-labelledby="acc-h">
          <h2 id="acc-h">Totals per account</h2>
          <DataTable caption="Totals per account" persistKey="ledger-accounts-v2" getRowId="account" quickFilter={accounts.length > 8}
            columnDefs={[
              { field: "account", headerName: "Account", type: "code", width: 380 },
              { field: "debit", headerName: "Debit", type: "money" }, { field: "credit", headerName: "Credit", type: "money" },
              { field: "balance", headerName: "Balance", type: "money" },
            ]}
            rowData={accounts.map((a) => ({ account: a.account, debit: a.debit, credit: a.credit, balance: a.balance }))} />
          <p className="small muted">Double entry: the totals row shows debits equal to credits, so the balances add up to {formatCents(0)}. paypal:hold:* is money held in PayPal for a tranche; its balance is what is still held. platform:fees on Rail A1 is invoiced to the provider per release.</p>
        </section>
      </div>

      <section className="c" aria-labelledby="e-h">
        <h2 id="e-h">Entries</h2>
        <p className="small muted">Switch on <b>Group by tranche</b> to see each tranche&apos;s entries together; its subtotal under “Effect on hold” is the money still held in PayPal for that tranche, next to the tranche&apos;s invariant.</p>
        <DataTable caption="Ledger entries" persistKey="ledger-entries-v2" getRowId="id" exportName="ledger" initialSort={{ field: "id", dir: "desc" }}
          emptyText="No entries match these filters."
          groupBy={{ field: "trancheId", labelField: "tranche", label: "tranche", carry: ["inv"] }}
          columnDefs={[
            { field: "tranche", headerName: "Contract · tranche", filter: true, width: 280 },
            { field: "id", headerName: "#", type: "number", width: 84 },
            { field: "at", headerName: "When", type: "date", width: 170 },
            { field: "type", headerName: "Type", type: "state", filter: true, width: 120 },
            { field: "code", headerName: "Milestone", type: "code", width: 118 },
            { field: "amount", headerName: "Amount", type: "money", total: false },
            { field: "effect", headerName: "Effect on hold", type: "money", tooltip: "Money into the PayPal hold (+) or out of it (−). Per tranche it adds up to what is still held." },
            { field: "debit", headerName: "Debit", type: "code", hide: true },
            { field: "credit", headerName: "Credit", type: "code", hide: true },
            { field: "ref", headerName: "PayPal reference", type: "code" },
            { field: "inv", headerName: "Invariant", type: "check", width: 108, tooltip: "held = released + returned + remaining for this entry's tranche" },
          ]}
          rowData={rows.map(({ e, title, idx, code }) => ({
            id: e.id, trancheId: e.trancheId, tranche: `${title} · tranche ${idx}`, at: e.at.toISOString(), type: e.type, code: code ?? null,
            amount: e.amountCents, effect: (isHold(e.debit) ? e.amountCents : 0) - (isHold(e.credit) ? e.amountCents : 0),
            debit: e.debit, credit: e.credit, ref: e.paypalRef ?? null, inv: invOk.has(e.trancheId) ? invOk.get(e.trancheId)! : null,
          }))} />
      </section>
    </>
  );
}
