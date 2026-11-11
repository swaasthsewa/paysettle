"use server";
/** F3.10 Run the hold-expiry watchdog now (same rules as the scheduled tick; it acts only on actions already due). */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { db } from "@/db/client";
import { requireViewer } from "@/lib/session";
import { runWatchdog } from "@/server/money";

export async function runWatchdogNow() {
  const v = await requireViewer(["ops", "admin", "judge"]);
  const r = await runWatchdog(new Date());
  await audit(db, { id: v.id, role: v.role }, "money.watchdog_run", "watchdog", { actions: r.actions.length });
  revalidatePath("/ops/radar");
  redirect(`/ops/radar?ran=${r.actions.length}`);
}
