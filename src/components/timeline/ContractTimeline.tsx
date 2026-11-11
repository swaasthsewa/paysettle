"use client";
/** F2.04 F2.13 F3.03 — loads the Bryntum Gantt only in the browser (Bryntum touches window/document on import). */
import dynamic from "next/dynamic";
import type { ContractPlan } from "./plan";
import type { GanttMode } from "./GanttView";

const GanttView = dynamic(() => import("./GanttView"), {
  ssr: false,
  loading: () => <div className="tl-loading" role="status">Loading the timeline…</div>,
});

export function ContractTimeline({ plan, mode = "plan" }: { plan: ContractPlan; mode?: GanttMode }) {
  return <GanttView key={mode} plan={plan} mode={mode} />;
}
