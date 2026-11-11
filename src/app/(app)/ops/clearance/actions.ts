"use server";
/** F2.11 — Operations clears a high-risk contract (it locks) or returns it to the parties with a note (it goes back to draft). */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearContract } from "@/server/contracts";
import { currentActor, domainMessage } from "@/server/contracts/web";

export async function clearanceAction(f: FormData) {
  const { a } = await currentActor(["ops"]);
  const id = String(f.get("wsId") ?? ""), decision = String(f.get("decision") ?? ""), note = String(f.get("note") ?? "");
  let msg = "";
  if (decision !== "clear" && decision !== "return") msg = "Choose clear or return.";
  else { try { await clearContract(a, id, decision, note); } catch (e) { msg = domainMessage(e); } }
  revalidatePath("/ops/clearance");
  redirect(msg ? `/ops/clearance?err=${encodeURIComponent(msg)}` : `/ops/clearance?ok=${decision === "clear" ? "cleared" : "returned"}`);
}
