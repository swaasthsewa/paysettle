"use client";
/**
 * F2.04 F3.03 F3.11 — contract timeline on Bryntum Gantt (sponsor trial package, aliased as @bryntum/gantt). Client-only:
 * loaded through next/dynamic with ssr:false from ContractTimeline. Read-only: the contract is changed in the contract
 * room, never here. Bars are coloured by where the milestone's money is; tranche windows are shaded time ranges.
 * F2.13 mode "proposed": the bars are a pending change order's milestones and the signed plan is drawn as Bryntum
 * baselines under each bar; a "Change" column says in words what the change order does to each row.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BryntumGantt } from "@bryntum/gantt-react";
import { StringHelper, TaskModel } from "@bryntum/gantt";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/stockholm-light.css";
import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import "@/styles/timeline.css";
import { TONE_LABEL, type ContractPlan, type MsTone } from "./plan";

/** Task model with the PaySettle fields the columns, labels and tooltips read. */
class MilestoneTask extends TaskModel {
  static $name = "MilestoneTask";
}
/* Bryntum declares `fields` as a static getter: a static class field would be an assignment to it (TypeError in strict
   mode once compiled for ES2017), so the getter is defined the way the library expects. */
Object.defineProperty(MilestoneTask, "fields", {
  configurable: true,
  get: () => [
    { name: "kind", type: "string" }, { name: "code", type: "string" }, { name: "state", type: "string" }, { name: "stateLabel", type: "string" },
    { name: "tone", type: "string" }, { name: "amountCents", type: "number" }, { name: "amountLabel", type: "string" },
    { name: "dayFrom", type: "number" }, { name: "dayTo", type: "number" }, { name: "href", type: "string" },
    { name: "change", type: "string" }, { name: "changeLabel", type: "string" },
  ],
});

const enc = (v: unknown) => StringHelper.encodeHtml(String(v ?? ""));
const fmt = (d: Date | string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(d));
type Rec = { get(field: string): unknown; isMilestone?: boolean; startDate?: Date | string; endDate?: Date | string };

export type GanttMode = "plan" | "proposed";

export default function GanttView({ plan, mode = "plan" }: { plan: ContractPlan; mode?: GanttMode }) {
  const proposed = mode === "proposed";
  const ref = useRef<BryntumGantt>(null);
  const router = useRouter();
  const gantt = () => ref.current?.instance;
  /* the proposed view is about the shift: show the whole contract at once so every moved bar is on screen */
  useEffect(() => {
    if (!proposed) return;
    const t = setTimeout(() => ref.current?.instance?.zoomToFit({ leftMargin: 40, rightMargin: 60 }), 300);
    return () => clearTimeout(t);
  }, [proposed]);

  return (
    <div className="tl-wrap">
      <div className="tl-tools" role="toolbar" aria-label="Timeline view">
        <button type="button" className="btn btn-sm" onClick={() => gantt()?.zoomIn()}>Zoom in</button>
        <button type="button" className="btn btn-sm" onClick={() => gantt()?.zoomOut()}>Zoom out</button>
        <button type="button" className="btn btn-sm" onClick={() => gantt()?.zoomToFit({ leftMargin: 40, rightMargin: 40 })}>Fit contract</button>
        <button type="button" className="btn btn-sm btn-gh" onClick={() => gantt()?.scrollToDate(new Date(plan.now), { block: "center", animate: true })}>Go to now</button>
        <span className="sp" />
        <span className="small muted">{proposed ? "Upper bars: as proposed. Thin bars under them: the signed plan." : "Select a bar to open its milestone."}</span>
      </div>
      <div className="tl-gantt ps-bry">
        <BryntumGantt
          ref={ref}
          project={{
            taskModelClass: MilestoneTask,
            tasks: plan.tasks as unknown as object[],
            dependencies: plan.dependencies.map((d) => ({ id: d.id, from: d.from, to: d.to, cls: d.cls })),
            timeRanges: plan.timeRanges,
          }}
          startDate={new Date(plan.startDate)}
          endDate={new Date(plan.endDate)}
          viewPreset="weekAndDayLetter"
          readOnly
          subGridConfigs={proposed ? { locked: { width: 560 } } : undefined}
          rowHeight={42}
          barMargin={9}
          columns={[
            { type: "name", field: "name", text: "Milestone", width: 260 },
            ...(proposed ? [{
              text: "Change", field: "changeLabel", width: 150,
              renderer: ({ record }: { record: Rec }) => record.get("kind") === "tranche" ? "" : ({ tag: "span", className: `ps-co-tag ps-co-tag-${String(record.get("change") ?? "same")}`, text: String(record.get("changeLabel") ?? "") }),
            }] : []),
            { text: "Days", field: "dayTo", width: 78, align: "right", renderer: ({ record }: { record: Rec }) => `${record.get("dayFrom")}–${record.get("dayTo")}` },
            { text: "Amount", field: "amountLabel", width: 112, align: "right" },
            {
              text: "Where the money is", field: "stateLabel", width: 200,
              renderer: ({ record }: { record: Rec }) => ({ tag: "span", className: `state ${record.get("tone") === "gate" ? "draft" : record.get("tone")}`, text: String(record.get("kind") === "tranche" ? record.get("stateLabel") : TONE_LABEL[record.get("tone") as MsTone] ?? "") }),
            },
          ]}
          timeRangesFeature={{ showCurrentTimeLine: false, showHeaderElements: true }}
          dependenciesFeature={{ allowCreate: false }}
          labelsFeature={{ right: { field: "amountLabel" } }}
          baselinesFeature={proposed ? { disabled: false } : false}
          percentBarFeature={false}
          projectLinesFeature={false}
          taskEditFeature={false}
          taskMenuFeature={false}
          cellEditFeature={false}
          taskTooltipFeature={{
            template: ({ taskRecord }: { taskRecord: unknown }) => {
              const r = taskRecord as Rec;
              const kind = r.get("kind");
              const when = kind === "gate" ? `Day ${enc(r.get("dayTo"))} · ${enc(fmt(r.endDate!))}` : `Days ${enc(r.get("dayFrom"))}–${enc(r.get("dayTo"))} · ${enc(fmt(r.startDate!))} to ${enc(fmt(r.endDate!))}`;
              const change = proposed && kind !== "tranche" ? `<div class="tl-tip-state">Change order: ${enc(r.get("changeLabel"))}</div>` : "";
              return `<div class="tl-tip"><b>${enc(r.get("name"))}</b><div>${when}</div>${change}`
                + `<div>${kind === "gate" ? "Gate · no money attached" : `${enc(r.get("amountLabel"))} · ${enc(TONE_LABEL[r.get("tone") as MsTone] ?? "")}`}</div>`
                + `<div class="tl-tip-state">${enc(r.get("stateLabel"))}</div></div>`;
            },
          }}
          taskRenderer={({ taskRecord }: { taskRecord: unknown }) => {
            const r = taskRecord as Rec;
            return r.get("kind") === "pay" ? enc(r.get("code")) : "";
          }}
          onTaskClick={({ taskRecord }: { taskRecord: unknown }) => {
            const href = (taskRecord as Rec).get("href");
            if (typeof href === "string" && href) router.push(href);
          }}
        />
      </div>
    </div>
  );
}
