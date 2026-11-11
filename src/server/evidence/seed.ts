/**
 * F3.04 / F3.06 demo content for the client review screen (used by scripts/seed-evidence.ts; idempotent).
 * On the LOCKED web-MVP contract, when its tranche is HELD: if the M01 kickoff gate is still open, the provider submits
 * the signed backlog and the client approves it (money records the zero-amount gate and opens M02); then the provider
 * submits M02 evidence (a PNG of the screens, a PDF screen list and the prototype link). Skips quietly otherwise.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { evidencePackages, tranches, workspaces, wsMilestones } from "@/db/schema";
import { approveMilestone, submitEvidence } from "./index";
import { samplePdf, samplePng } from "./samples";

export async function seedEvidence(title = "Booking app MVP"): Promise<string> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.title, title)).limit(1);
  if (!ws) return `skip: no '${title}' contract seeded yet`;
  if (ws.state !== "LOCKED" || !ws.providerId) return `skip: contract is ${ws.state}`;
  const ms = await db.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, ws.id)).orderBy(asc(wsMilestones.seq));
  const m2 = ms.find((m) => m.code === "M02");
  if (!m2) return "skip: no M02 milestone";
  const [t] = await db.select().from(tranches).where(and(eq(tranches.workspaceId, ws.id), eq(tranches.idx, m2.trancheIdx))).limit(1);
  if (!t || t.state !== "HELD") return `skip: tranche ${m2.trancheIdx} is ${t?.state ?? "missing"}, not HELD`;
  const [existing] = await db.select({ id: evidencePackages.id }).from(evidencePackages).where(eq(evidencePackages.milestoneId, m2.id)).limit(1);
  if (existing) return "skip: M02 already has evidence";
  const provider = { id: ws.providerId, role: "provider" as const, name: "seed" };
  const client = { id: ws.clientId, role: "client" as const, name: "seed" };
  const steps: string[] = [];

  const m1 = ms.find((m) => m.code === "M01");
  if (m1 && m1.type === "GATE" && (m1.state === "OPEN" || m1.state === "SUBMITTED")) {
    try {
      let root: string;
      if (m1.state === "OPEN") {
        const r = await submitEvidence(provider, m1.id, [{ name: "signed-backlog.pdf", type: "application/pdf", bytes: samplePdf("Booking app MVP - signed backlog (M01)", [
          "F1 Sign in / sign up - email + Google; acceptance: new user can book in under 2 minutes",
          "F2 Availability search - by date and party size", "F3 Slot booking with PayPal checkout",
          "F4 Confirmation email and calendar invite", "F5 My bookings - cancel / reschedule", "F6 Admin calendar and blackout dates",
          "F7 Basic analytics: bookings per day", "Signed: client and provider, day 2",
        ]) }], "Repository invite accepted: https://github.com/example/booking-mvp\nHosting access granted on day 2.");
        root = r.rootHash;
      } else {
        const [p] = await db.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, m1.id)).orderBy(asc(evidencePackages.attempt));
        root = p.rootHash;
      }
      await approveMilestone(client, m1.id, root);
      steps.push("M01 gate approved");
    } catch (e) { return `skip: M01 gate could not be passed (${(e as Error).message})`; }
  }

  try {
    const r = await submitEvidence(provider, m2.id, [
      { name: "booking-flow-screens.png", type: "image/png", bytes: samplePng(480, 300, 172) },
      { name: "screen-list.pdf", type: "application/pdf", bytes: samplePdf("Booking app MVP - screen list (M02)", [
        "1. Sign in / sign up", "2. Search availability by date", "3. Pick a slot and party size", "4. Checkout with PayPal",
        "5. Booking confirmation and email", "6. My bookings (cancel / reschedule)", "7. Admin: calendar and blackout dates",
        "Every backlog feature from M01 has at least one screen.",
      ]) },
    ], "Clickable prototype: https://prototype.example.com/booking-mvp\nAll seven backlog features have screens; see the PDF for the list.");
    steps.push(`M02 evidence ${r.packageId} root ${r.rootHash.slice(0, 12)}…`);
    return `seeded ${steps.join("; ")}`;
  } catch (e) {
    return `skip: ${steps.length ? steps.join("; ") + "; " : ""}M02 not submitted (${(e as Error).message})`;
  }
}
