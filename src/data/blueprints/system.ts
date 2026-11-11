import type { BlueprintClause } from "@/db/schema";
/** System clauses: present in every contract, cannot be switched off (P5, R07). Wording is honest about PayPal's own rights (P10). */
export const SYSTEM_CLAUSES: BlueprintClause[] = [
  { code: "SYS_01_HOLD", category: "SYSTEM", title: "Funds held through PayPal", body: "Each tranche is funded through PayPal before work on it starts. PaySettle never receives the client's money into its own account in production.", protective: true },
  { code: "SYS_02_WINDOW", category: "SYSTEM", title: "Hold window", body: "A PayPal hold lasts a limited time. Before it ends, approved milestones are released, unstarted milestones are returned to the client, and the parties may roll the remainder into a new tranche with the client's approval.", protective: true },
  { code: "SYS_03_RELEASE_FINAL", category: "SYSTEM", title: "Release-final", body: "Once a milestone is released on the client's signed approval or a mediator's signed verdict, PaySettle accepts no further dispute on it. PayPal's own buyer and seller programmes still apply.", protective: true },
  { code: "SYS_04_EVIDENCE", category: "SYSTEM", title: "Evidence and review", body: "The provider submits the evidence named in each milestone. The client reviews within 48 hours; reminders are sent at 24 and 36 hours. Uploaded files are kept unchanged.", protective: true },
  { code: "SYS_05_DISPUTES", category: "SYSTEM", title: "Scoped disputes", body: "A dispute freezes only the disputed milestone. It proceeds by sealed offers (48 hours), an evidence vault (to 96 hours) and, if needed, a mediator's verdict. AI proposals are advisory; people decide.", protective: true },
  { code: "SYS_06_NO_SIDE_PAYMENTS", category: "SYSTEM", title: "No side payments", body: "Payments for milestones in this contract go through PaySettle and PayPal only.", protective: true },
];
