/** F2.03 — /contracts sends each person to the contract list for their role. */
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/session";

export default async function Page() {
  const v = await requireViewer();
  redirect(v.role === "provider" ? "/provider/contracts" : v.role === "client" ? "/client/contracts" : v.role === "ops" ? "/ops/clearance" : "/blueprints");
}
