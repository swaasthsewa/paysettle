"use client";
/** F4.01 F4.05 — loads the Bryntum Scheduler only in the browser (Bryntum touches window/document on import). */
import dynamic from "next/dynamic";
import type { CaseEvent } from "./plan";

export type ScheduleEvent = CaseEvent & { mediator: string; cosigner: string | null; client: string; provider: string; fastTrack: boolean; amountCents: number };
export interface ScheduleProps {
  resources: { id: string; name: string; open: number; you: boolean }[];
  events: ScheduleEvent[];
  now: string; startDate: string; endDate: string;
}

const SchedulerView = dynamic(() => import("./SchedulerView"), {
  ssr: false,
  loading: () => <div className="tl-loading" role="status">Loading the schedule…</div>,
});

export function MediatorSchedule({ data }: { data: ScheduleProps }) {
  return <SchedulerView data={data} />;
}
