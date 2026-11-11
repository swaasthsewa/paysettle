"use client";
/** F2.04 F3.03 — loads the Bryntum Gantt only in the browser (Bryntum touches window/document on import). */
import dynamic from "next/dynamic";
import type { ContractPlan } from "./plan";

const GanttView = dynamic(() => import("./GanttView"), {
  ssr: false,
  loading: () => <div className="tl-loading" role="status">Loading the timeline…</div>,
});

export function ContractTimeline({ plan }: { plan: ContractPlan }) {
  return <GanttView plan={plan} />;
}
