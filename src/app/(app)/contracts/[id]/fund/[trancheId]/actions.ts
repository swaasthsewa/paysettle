"use server";
/** F3.01 Fund a tranche: create the PayPal order (authorize intent on Rail A) and send the buyer to PayPal's approval page. */
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireViewer } from "@/lib/session";
import { fundTranche } from "@/server/money";

const In = z.object({ workspaceId: z.string().min(3).max(64), trancheId: z.string().min(3).max(64) });

export async function fundAction(f: FormData) {
  const v = await requireViewer();
  const p = In.safeParse({ workspaceId: f.get("workspaceId"), trancheId: f.get("trancheId") });
  if (!p.success) redirect("/client/contracts");
  const back = `/contracts/${p.data.workspaceId}/fund/${p.data.trancheId}`;
  let url: string;
  try { url = (await fundTranche({ id: v.id, role: v.role, name: v.name }, p.data.trancheId)).approveUrl; }
  catch (e) { redirect(`${back}?error=${encodeURIComponent(e instanceof Error ? e.message : "PayPal could not start checkout.")}`); }
  redirect(url);
}
