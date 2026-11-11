"use client";
/**
 * F2.04 F3.03 F3.11 — contract timeline on Bryntum Gantt (sponsor trial package, aliased as @bryntum/gantt). Client-only:
 * loaded through next/dynamic with ssr:false from ContractTimeline. Read-only: the contract is changed in the contract
 * room, never here. Bars are coloured by where the milestone's money is; tranche windows are shaded time ranges.
 */
import { useRef } from "react";
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
  static fields = [
    { name: "kind", type: "string" }, { name: "code", type: "string" }, { name: "state", type: "string" }, { name: "stateLabel", type: "string" },
    { name: "tone", type: "string" }, { name: "amountCents", type: "number" }, { name: "amountLabel", type: "string" },
    { name: "dayFrom", type: "number" }, { name: "dayTo", type: "number" }, { name: "href", type: "string" },
  ];
}

const enc = (v: unknown) => StringHelper.encodeHtml(String(v ?? ""));
const fmt = (d: Date | string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(d));
type Rec = { get(field: string): unknown; isMilestone?: boolean; startDate?: Date | string; endDate?: Date | string };

export default function GanttView({ plan }: { plan: ContractPlan }) {
  const ref = useRef<BryntumGantt>(null);
  const router = useRouter();
  const gantt = () => ref.current?.instance;

  return (
    <div className="tl-wrap">
      <div className="tl-tools" role="toolbar" aria-label="Timeline view">
        <button type="button" className="btn btn-sm" onClick={() => gantt()?.zoomIn()}>Zoom in</button>
        <button type="button" className="btn btn-sm" onClick={() => gantt()?.zoomOut()}>Zoom out</button>
        <button type="button" className="btn btn-sm" onClick={() => gantt()?.zoomToFit({ leftMargin: 40, rightMargin: 40 })}>Fit contract</button>
        <button type="button" className="btn btn-sm btn-gh" onClick={() => gantt()?.scrollToDate(new Date(plan.now), { block: "center", animate: true })}>Go to now</button>
        <span className="sp" />
        <span className="small muted">Select a bar to open its milestone.</span>
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
          rowHeight={42}
          barMargin={9}
          columns={[
            { type: "name", field: "name", text: "Milestone", width: 260 },
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
              return `<div class="tl-tip"><b>${enc(r.get("name"))}</b><div>${when}</div>`
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
