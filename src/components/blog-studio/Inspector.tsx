"use client";
/**
 * P10 blog studio — inspector for the selected block: a field form per block type, then motion (anim) and honesty
 * (claimStatus + sources) for every block. Field errors come from the same zod union the server validates with.
 */
import { ANIM_KEYS, ANIM_META, BLOCK_META, CLAIM_META, CLAIM_STATUSES, type AnimKey, type Block, type BlogSource, type ClaimStatus } from "@/lib/blog/blocks";
import { BLUEPRINTS } from "@/data/blueprints";
import { pct } from "@/lib/money";
import { AreaField, CentsField, CheckField, IntField, Repeat, SelectField, TextField } from "./fields";
import { blockIssues, issuesAt } from "./model";

type Patch = (b: Block) => void;

const FULL_BLUEPRINTS = BLUEPRINTS.map((b) => ({ value: b.code, label: `${b.title} (${b.code})${b.depth === "outline" ? " · outline" : ""}` }));

export function Inspector({ block, index, total, onChange, onDuplicate, onRemove }: { block: Block | null; index: number; total: number; onChange: Patch; onDuplicate: () => void; onRemove: () => void }) {
  if (!block) {
    return (
      <aside className="bs-inspector" aria-label="Block settings">
        <p className="muted">Pick a block in the list to edit its words, motion and sources.</p>
      </aside>
    );
  }
  const b = block;
  const issues = blockIssues(b);
  const at = (...p: (string | number)[]) => issuesAt(issues, ...p);
  const set = (patch: Record<string, unknown>) => onChange({ ...b, ...patch } as Block);
  return (
    <aside className="bs-inspector" aria-label={`Settings for block ${index + 1}: ${BLOCK_META[b.type].label}`}>
      <div className="bs-ins-head">
        <div><h2>{BLOCK_META[b.type].label}</h2><p className="small muted">Block {index + 1} of {total} · {BLOCK_META[b.type].hint}</p></div>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="btn btn-sm" onClick={onRemove}>Delete</button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{issues.length ? `${issues.length} problem${issues.length === 1 ? "" : "s"} in this block.` : ""}</p>
      {issues.length > 0 && <div className="notice" data-b="warn"><b>This block cannot be saved yet.</b> {issues.slice(0, 3).map((i) => i.message).join(" ")}</div>}

      <section className="bs-ins-sec" aria-labelledby={`ins-content-${b.id}`}>
        <h3 id={`ins-content-${b.id}`} className="bs-cap">Content</h3>
        <Fields b={b} set={set} at={at} />
      </section>

      <section className="bs-ins-sec" aria-labelledby={`ins-motion-${b.id}`}>
        <h3 id={`ins-motion-${b.id}`} className="bs-cap">Motion</h3>
        <SelectField<AnimKey> label="Animation" value={(b.anim ?? "none") as AnimKey} onChange={(v) => set({ anim: v === "none" ? undefined : v })}
          options={ANIM_KEYS.map((k) => ({ value: k, label: `${ANIM_META[k].label} — ${ANIM_META[k].hint}` }))} hint="Readers who ask for reduced motion always see the block still." errs={at("anim")} />
      </section>

      <section className="bs-ins-sec" aria-labelledby={`ins-honesty-${b.id}`}>
        <h3 id={`ins-honesty-${b.id}`} className="bs-cap">Honesty</h3>
        <SelectField<ClaimStatus | ""> label="What kind of claim is this?" value={(b.claimStatus ?? "") as ClaimStatus | ""}
          onChange={(v) => set({ claimStatus: v || undefined })}
          options={[{ value: "", label: "No label" }, ...CLAIM_STATUSES.map((c) => ({ value: c, label: `${CLAIM_META[c].label} — ${CLAIM_META[c].hint}` }))]}
          hint="Figures need a source, or the Illustrative / How PaySettle works label." errs={at("claimStatus")} />
        <Repeat<BlogSource> legend="Sources" items={b.sources ?? []} max={6} itemLabel={(i) => `Source ${i + 1}`}
          onChange={(next) => set({ sources: next.length ? next : undefined })} make={() => ({ title: "", url: "https://" })} errs={at("sources").length && !(b.sources ?? []).length ? at("sources") : []}
          render={(s, put, i) => (
            <>
              <TextField label="Title" value={s.title} max={200} onChange={(v) => put({ ...s, title: v })} errs={at("sources", i, "title")} />
              <TextField label="Address (https://…)" value={s.url} mono onChange={(v) => put({ ...s, url: v })} errs={at("sources", i, "url")} />
            </>
          )} />
      </section>
    </aside>
  );
}

function Fields({ b, set, at }: { b: Block; set: (p: Record<string, unknown>) => void; at: (...p: (string | number)[]) => string[] }) {
  switch (b.type) {
    case "tldr":
      return (
        <>
          <TextField label="Box title" value={b.title} max={60} onChange={(v) => set({ title: v })} errs={at("title")} />
          <Repeat<string> legend="Points" items={b.items} min={1} max={5} itemLabel={(i) => `Point ${i + 1}`} onChange={(items) => set({ items })} make={() => ""} errs={at("items").filter(() => b.items.length === 0)}
            render={(s, put, i) => <AreaField label="Text" rows={2} value={s} max={240} onChange={put} errs={at("items", i)} />} />
        </>
      );
    case "heading":
      return (
        <>
          <TextField label="Heading" value={b.text} max={140} onChange={(v) => set({ text: v })} errs={at("text")} />
          <SelectField<"2" | "3"> label="Level" value={String(b.level) as "2" | "3"} onChange={(v) => set({ level: Number(v) })} options={[{ value: "2", label: "Section (H2, shown in contents)" }, { value: "3", label: "Sub-section (H3)" }]} />
        </>
      );
    case "text":
      return <AreaField label="Text" rows={10} value={b.body} max={6000} onChange={(v) => set({ body: v })} errs={at("body")} hint="Blank line = new paragraph. **bold**, *italic*, [label](/path or https://…). No HTML." />;
    case "image":
      return (
        <>
          <TextField label="Image path" value={b.src} mono onChange={(v) => set({ src: v })} errs={at("src")} hint="A file in public/blog, e.g. /blog/tranches.svg" />
          <AreaField label="Alt text" rows={2} value={b.alt} max={240} onChange={(v) => set({ alt: v })} errs={at("alt")} hint="What the image shows, for people who cannot see it." />
          <TextField label="Caption (optional)" value={b.caption ?? ""} max={240} onChange={(v) => set({ caption: v || undefined })} errs={at("caption")} />
        </>
      );
    case "quote":
      return (
        <>
          <AreaField label="Quote" rows={4} value={b.text} max={600} onChange={(v) => set({ text: v })} errs={at("text")} />
          <TextField label="Attribution" value={b.by} max={120} onChange={(v) => set({ by: v })} errs={at("by")} hint="Name and role. Anonymise private people." />
        </>
      );
    case "callout":
      return (
        <>
          <SelectField<"info" | "warn" | "ok"> label="Tone" value={b.tone} onChange={(v) => set({ tone: v })} options={[{ value: "info", label: "Information" }, { value: "warn", label: "Warning" }, { value: "ok", label: "Good news" }]} />
          <TextField label="Title (optional)" value={b.title ?? ""} max={80} onChange={(v) => set({ title: v || undefined })} errs={at("title")} />
          <AreaField label="Text" rows={4} value={b.body} max={1200} onChange={(v) => set({ body: v })} errs={at("body")} />
        </>
      );
    case "statRow":
      return (
        <Repeat legend="Figures" items={b.stats} min={2} max={4} itemLabel={(i) => `Figure ${i + 1}`} onChange={(stats) => set({ stats })} make={() => ({ value: "0", label: "Label" })}
          render={(s, put, i) => (
            <>
              <TextField label="Value" value={s.value} max={24} onChange={(v) => put({ ...s, value: v })} errs={at("stats", i, "value")} />
              <TextField label="Label" value={s.label} max={80} onChange={(v) => put({ ...s, label: v })} errs={at("stats", i, "label")} />
            </>
          )} />
      );
    case "stepList":
      return (
        <>
          <TextField label="Title (optional)" value={b.title ?? ""} max={100} onChange={(v) => set({ title: v || undefined })} errs={at("title")} />
          <Repeat legend="Steps" items={b.steps} min={2} max={10} itemLabel={(i) => `Step ${i + 1}`} onChange={(steps) => set({ steps })} make={() => ({ title: "Step", body: "What happens." })}
            render={(s, put, i) => (
              <>
                <TextField label="Step title" value={s.title} max={100} onChange={(v) => put({ ...s, title: v })} errs={at("steps", i, "title")} />
                <AreaField label="Detail" rows={3} value={s.body} max={600} onChange={(v) => put({ ...s, body: v })} errs={at("steps", i, "body")} />
              </>
            )} />
        </>
      );
    case "faq":
      return (
        <Repeat legend="Questions" items={b.items} min={1} max={10} itemLabel={(i) => `Question ${i + 1}`} onChange={(items) => set({ items })} make={() => ({ q: "Question?", a: "Answer." })}
          render={(s, put, i) => (
            <>
              <TextField label="Question" value={s.q} max={200} onChange={(v) => put({ ...s, q: v })} errs={at("items", i, "q")} />
              <AreaField label="Answer" rows={4} value={s.a} max={1200} onChange={(v) => put({ ...s, a: v })} errs={at("items", i, "a")} />
            </>
          )} />
      );
    case "divider":
      return <p className="small muted">A plain section break. Nothing to set.</p>;
    case "cta":
      return (
        <>
          <TextField label="Heading" value={b.title} max={100} onChange={(v) => set({ title: v })} errs={at("title")} />
          <AreaField label="Text (optional)" rows={2} value={b.body ?? ""} max={300} onChange={(v) => set({ body: v || undefined })} errs={at("body")} />
          <TextField label="Button label" value={b.label} max={40} onChange={(v) => set({ label: v })} errs={at("label")} />
          <TextField label="Link (a path on this site)" value={b.href} mono onChange={(v) => set({ href: v })} errs={at("href")} hint="e.g. /playground or /how-it-works. Outside links are not allowed in buttons." />
        </>
      );
    case "caseStudy":
      return (
        <>
          <SelectField label="Blueprint" value={b.blueprintCode} options={FULL_BLUEPRINTS.some((o) => o.value === b.blueprintCode) ? FULL_BLUEPRINTS : [{ value: b.blueprintCode, label: `${b.blueprintCode} (unknown)` }, ...FULL_BLUEPRINTS]}
            onChange={(v) => set({ blueprintCode: v })} errs={at("blueprintCode")} hint="The real milestone list of this blueprint is shown with amounts." />
          <CentsField label="Contract total" value={b.totalCents} onChange={(c) => set({ totalCents: c })} errs={at("totalCents")} />
          <AreaField label="Before PaySettle" rows={3} value={b.before} max={600} onChange={(v) => set({ before: v })} errs={at("before")} />
          <AreaField label="With PaySettle" rows={3} value={b.after} max={600} onChange={(v) => set({ after: v })} errs={at("after")} />
          <Repeat<string> legend="Highlighted milestone codes" items={b.highlight ?? []} max={6} itemLabel={(i) => `Code ${i + 1}`} onChange={(h) => set({ highlight: h.length ? h : undefined })} make={() => "M01"}
            render={(s, put, i) => <TextField label="Milestone code" value={s} max={40} mono onChange={put} errs={at("highlight", i)} />} />
        </>
      );
    case "moneyFlow":
      return (
        <>
          <CentsField label="Amount held" value={b.totalCents} onChange={(c) => set({ totalCents: c })} errs={at("totalCents")} />
          <IntField label="Released to provider (basis points)" value={b.releasedBps} min={0} max={10_000} onChange={(v) => set({ releasedBps: v })} errs={at("releasedBps")} hint={`${pct(b.releasedBps)} of the amount · 10,000 = 100%`} />
          <IntField label="Refunded to client (basis points)" value={b.refundedBps} min={0} max={10_000} onChange={(v) => set({ refundedBps: v })} errs={[...at("refundedBps"), ...(b.releasedBps + b.refundedBps > 10_000 ? ["Released and refunded together cannot pass 10,000 (100%)."] : [])]} hint={pct(b.refundedBps)} />
          <IntField label="Platform fee (basis points)" value={b.feeBps} min={0} max={1_000} onChange={(v) => set({ feeBps: v })} errs={at("feeBps")} hint={`${pct(b.feeBps)} of the released part only. PaySettle's default is 250.`} />
          <TextField label="Caption (optional)" value={b.caption ?? ""} max={240} onChange={(v) => set({ caption: v || undefined })} errs={at("caption")} />
          <CheckField label="Reader can move a slider" checked={b.interactive} onChange={(v) => set({ interactive: v })} />
        </>
      );
    case "trancheTimeline":
      return (
        <>
          <IntField label="Job length (days)" value={b.totalDays} min={1} max={365} onChange={(v) => set({ totalDays: v })} errs={at("totalDays")} />
          <SelectField<"A1" | "A2" | "B"> label="PayPal rail" value={b.rail} onChange={(v) => set({ rail: v })} options={[{ value: "A1", label: "A1 — authorize and capture" }, { value: "A2", label: "A2 — capture and hold" }, { value: "B", label: "B — delayed disbursement" }]} />
          <TextField label="Caption (optional)" value={b.caption ?? ""} max={240} onChange={(v) => set({ caption: v || undefined })} errs={at("caption")} />
        </>
      );
    case "apiSnippet":
      return (
        <>
          <SelectField<"GET" | "POST" | "PATCH"> label="Method" value={b.method} onChange={(v) => set({ method: v })} options={[{ value: "GET", label: "GET" }, { value: "POST", label: "POST" }, { value: "PATCH", label: "PATCH" }]} />
          <TextField label="Path" value={b.path} max={200} mono onChange={(v) => set({ path: v })} errs={at("path")} />
          <AreaField label="Request (optional)" rows={6} value={b.request ?? ""} max={4000} mono onChange={(v) => set({ request: v || undefined })} errs={at("request")} hint="Never paste keys or tokens. Use <ACCESS_TOKEN>." />
          <AreaField label="Response (optional)" rows={6} value={b.response ?? ""} max={4000} mono onChange={(v) => set({ response: v || undefined })} errs={at("response")} />
          <TextField label="Note (optional)" value={b.note ?? ""} max={300} onChange={(v) => set({ note: v || undefined })} errs={at("note")} />
        </>
      );
    case "compareTable": {
      const cols = b.columns.length;
      const fit = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? "");
      return (
        <>
          <Repeat<string> legend="Columns" items={b.columns} min={2} max={4} itemLabel={(i) => `Column ${i + 1}`} make={() => "Column"}
            onChange={(columns) => set({ columns, rows: b.rows.map((r) => Array.from({ length: columns.length }, (_, i) => r[i] ?? "")) })}
            render={(s, put, i) => <TextField label="Heading" value={s} max={60} onChange={put} errs={at("columns", i)} />} />
          <Repeat<string[]> legend="Rows" items={b.rows} min={1} max={12} itemLabel={(i) => `Row ${i + 1}`} make={() => fit([])} onChange={(rows) => set({ rows })}
            render={(r, put, i) => <>{fit(r).map((cell, j) => <TextField key={j} label={b.columns[j] || `Column ${j + 1}`} value={cell} max={160} onChange={(v) => { const n = fit(r); n[j] = v; put(n); }} errs={at("rows", i, j)} />)}</>} />
        </>
      );
    }
  }
}
