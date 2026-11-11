"use client";
/**
 * F4.01 F4.05 — mediator schedule on Bryntum Scheduler (from the Gantt trial bundle, so one Bryntum bundle serves both
 * pages). One row per mediator plus "Not assigned yet"; each case is one bar from opening to its verdict deadline with
 * the sealed-offer, vault and verdict phases drawn inside it. Read-only; selecting a case opens its workbench.
 */
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { BryntumScheduler } from "@bryntum/gantt-react";
import { StringHelper } from "@bryntum/gantt";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/stockholm-light.css";
import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import "@/styles/timeline.css";
import type { ScheduleEvent, ScheduleProps } from "./MediatorSchedule";

const enc = (v: unknown) => StringHelper.encodeHtml(String(v ?? ""));
const when = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
type Rec = { get(field: string): unknown; data?: Record<string, unknown> };
const field = <T,>(r: Rec, f: string) => (r.get(f) ?? r.data?.[f]) as T;

export default function SchedulerView({ data }: { data: ScheduleProps }) {
  const ref = useRef<BryntumScheduler>(null);
  const router = useRouter();
  const sch = () => ref.current?.instance;

  return (
    <div className="tl-wrap">
      <div className="tl-tools" role="toolbar" aria-label="Schedule view">
        <button type="button" className="btn btn-sm" onClick={() => sch()?.zoomIn()}>Zoom in</button>
        <button type="button" className="btn btn-sm" onClick={() => sch()?.zoomOut()}>Zoom out</button>
        <button type="button" className="btn btn-sm" onClick={() => sch()?.zoomToFit({ leftMargin: 30, rightMargin: 30 })}>Fit all cases</button>
        <button type="button" className="btn btn-sm btn-gh" onClick={() => sch()?.scrollToDate(new Date(data.now), { block: "center", animate: true })}>Go to now</button>
        <span className="sp" />
        <span className="small muted">Select a case to open its workbench.</span>
      </div>
      <div className="tl-sched ps-bry">
        <BryntumScheduler
          ref={ref}
          resources={data.resources.map((r) => ({ id: r.id, name: r.name, open: r.open, cls: r.you ? "ps-res-you" : r.id === "unassigned" ? "ps-res-none" : "" }))}
          events={data.events.map((e) => ({ ...e, phases: e.phases })) as unknown as object[]}
          timeRanges={[{ id: "now", name: "Now", startDate: data.now, cls: "ps-now" }]}
          startDate={new Date(data.startDate)}
          endDate={new Date(data.endDate)}
          viewPreset="dayAndWeek"
          readOnly
          rowHeight={64}
          barMargin={8}
          eventStyle="rounded"
          eventLayout="stack"
          columns={[
            { text: "Mediator", field: "name", width: 190, renderer: ({ record }: { record: Rec }) => ({ tag: "span", className: field<string>(record, "cls") === "ps-res-you" ? "ps-you" : "", text: `${field<string>(record, "name")}${field<string>(record, "cls") === "ps-res-you" ? " (you)" : ""}` }) },
            { text: "Open", field: "open", width: 70, align: "right" },
          ]}
          timeRangesFeature={{ showCurrentTimeLine: false, showHeaderElements: true }}
          eventEditFeature={false}
          eventMenuFeature={false}
          scheduleMenuFeature={false}
          cellEditFeature={false}
          eventDragCreateFeature={false}
          eventRenderer={({ eventRecord }: { eventRecord: unknown }) => {
            const r = eventRecord as Rec;
            const phases = field<ScheduleEvent["phases"]>(r, "phases") ?? [];
            const segs = phases.map((p) => `<i class="ps-ph ps-ph-${enc(p.key)}${p.current ? " cur" : ""}${p.past ? " past" : ""}" style="width:${Number(p.pct) || 0}%"></i>`).join("");
            const next = field<ScheduleEvent["next"]>(r, "next");
            return `<div class="ps-case-body"><div class="ps-case-t"><b>${enc(field(r, "name"))}</b> · ${enc(field(r, "amountLabel"))}</div>`
              + `<div class="ps-case-s">${enc(field(r, "stateLabel"))}${next ? ` · ${enc(next.label)} ${enc(when(next.at))}` : ""}${field<boolean>(r, "overdue") ? " · past due" : ""}</div>`
              + `<div class="ps-phases" aria-hidden="true">${segs}</div></div>`;
          }}
          eventTooltipFeature={{
            template: ({ eventRecord }: { eventRecord: unknown }) => {
              const r = eventRecord as Rec;
              const phases = field<ScheduleEvent["phases"]>(r, "phases") ?? [];
              const cos = field<string | null>(r, "cosigner");
              return `<div class="tl-tip"><b>${enc(field(r, "name"))}</b><div>${enc(field(r, "workspace"))} · ${enc(field(r, "client"))} and ${enc(field(r, "provider"))}</div>`
                + `<div>${enc(field(r, "amountLabel"))} disputed · ${enc(field(r, "stateLabel"))}${field<boolean>(r, "fastTrack") ? " · fast track" : ""}</div>`
                + `<ul>${phases.map((p) => `<li${p.current ? ' class="cur"' : ""}>${enc(p.label)}: ${enc(when(p.from))} → ${enc(when(p.to))}</li>`).join("")}</ul>`
                + `<div class="tl-tip-state">Mediator: ${enc(field(r, "mediator"))}${cos ? ` · co-signer ${enc(cos)}` : ""}</div></div>`;
            },
          }}
          onEventClick={({ eventRecord }: { eventRecord: unknown }) => {
            const href = field<string>(eventRecord as Rec, "href");
            if (href) router.push(href);
          }}
          onPaint={({ firstPaint }: { firstPaint: boolean }) => { if (firstPaint) void sch()?.scrollToDate(new Date(data.now), { block: "center" }); }}
        />
      </div>
    </div>
  );
}
