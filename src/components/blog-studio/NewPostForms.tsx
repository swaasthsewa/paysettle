"use client";
/**
 * P3 — the two ways to start a post: write it yourself, or give a brief and let the AI gateway draft it (a rule-based
 * outline when AI is off). Both land as a DRAFT in the editor; nothing is published from here.
 */
import { useActionState, useId } from "react";
import { TOPICS, TOPIC_LABEL } from "@/lib/blog/blocks";
import { createManualAction, draftAiAction, type FormState } from "@/app/(app)/marketing/blog/actions";

function Err({ id, msg }: { id: string; msg?: string }) {
  return msg ? <p id={id} className="bs-err">{msg}</p> : null;
}

function TopicSelect({ id, err }: { id: string; err?: string }) {
  return (
    <select id={id} name="topic" className="input" defaultValue="explainer" aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-err` : undefined}>
      {TOPICS.map((t) => <option key={t} value={t}>{TOPIC_LABEL[t]}</option>)}
    </select>
  );
}

export function ManualForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createManualAction, {});
  const id = useId();
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="stack" noValidate aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Write it yourself</h2>
      <p className="small muted">Starts a draft with a summary and one section. Placeholders are marked [Outline] and must be replaced before publishing.</p>
      <div className="field">
        <label htmlFor={`${id}-title`}>Title</label>
        <input id={`${id}-title`} name="title" className="input" required minLength={3} maxLength={140} aria-invalid={fe.title ? true : undefined} aria-describedby={fe.title ? `${id}-title-err` : undefined} />
        <Err id={`${id}-title-err`} msg={fe.title} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-dek`}>One-line summary <span className="muted">(optional now, needed to publish)</span></label>
        <textarea id={`${id}-dek`} name="dek" className="input" rows={2} maxLength={300} aria-invalid={fe.dek ? true : undefined} aria-describedby={fe.dek ? `${id}-dek-err` : undefined} />
        <Err id={`${id}-dek-err`} msg={fe.dek} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-topic`}>Topic</label>
        <TopicSelect id={`${id}-topic`} err={fe.topic} />
        <Err id={`${id}-topic-err`} msg={fe.topic} />
      </div>
      <div className="row"><button className="btn btn-g btn-sm" type="submit" disabled={pending}>{pending ? "Creating…" : "Create draft"}</button></div>
      {state.error ? <p className="notice" data-b="warn" role="alert">{state.error}</p> : null}
    </form>
  );
}

export function BriefForm({ aiStatus }: { aiStatus: { available: boolean; reason?: string; model?: string } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(draftAiAction, {});
  const id = useId();
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="stack" noValidate aria-labelledby={`${id}-h`} aria-busy={pending}>
      <h2 id={`${id}-h`}>Draft from a brief</h2>
      <p className="small muted">
        {aiStatus.available
          ? `The AI (${aiStatus.model}) proposes blocks. You review every figure and source; AI never publishes.`
          : `AI is not available right now (${aiStatus.reason ?? "switched off"}). You will get a rule-based outline to fill in.`}
      </p>
      <div className="field">
        <label htmlFor={`${id}-title`}>Working title</label>
        <input id={`${id}-title`} name="title" className="input" required minLength={3} maxLength={140} aria-invalid={fe.title ? true : undefined} aria-describedby={fe.title ? `${id}-title-err` : undefined} />
        <Err id={`${id}-title-err`} msg={fe.title} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-topic`}>Topic</label>
        <TopicSelect id={`${id}-topic`} err={fe.topic} />
        <Err id={`${id}-topic-err`} msg={fe.topic} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-angle`}>What should the post explain?</label>
        <textarea id={`${id}-angle`} name="angle" className="input" rows={5} maxLength={2000} required aria-invalid={fe.angle ? true : undefined} aria-describedby={`${id}-angle-help${fe.angle ? ` ${id}-angle-err` : ""}`} />
        <span id={`${id}-angle-help`} className="small muted">Two or three sentences: the reader, the question, the example you want. Paste source links you want cited.</span>
        <Err id={`${id}-angle-err`} msg={fe.angle} />
      </div>
      <div className="row">
        <button className="btn btn-g btn-sm" type="submit" disabled={pending}>{pending ? "Drafting… this can take up to a minute" : aiStatus.available ? "Draft with AI" : "Create outline"}</button>
      </div>
      <p className="sr-only" aria-live="polite">{pending ? "Drafting the post." : ""}</p>
      {state.error ? <p className="notice" data-b="warn" role="alert">{state.error}</p> : null}
    </form>
  );
}
