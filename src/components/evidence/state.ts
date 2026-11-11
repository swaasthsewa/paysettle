/** F3.06 / F3.09 milestone state words and colours shared by the milestone page and MilestoneRow. */
export const MS_STATE_LABEL: Record<string, string> = {
  DRAFT: "Draft", LOCKED: "Locked", OPEN: "Open for evidence", SUBMITTED: "In client review", REMEDIATION: "Fix requested",
  APPROVED: "Approved", RELEASED: "Released", DISPUTED: "In dispute", ESCALATED: "Escalated to Operations",
  SETTLED_BY_VERDICT: "Settled by verdict", REFUNDED: "Refunded",
};
/** Maps to the global .state classes: where the money is. */
export function msStateClass(s: string): "held" | "released" | "disputed" | "refunded" | "draft" {
  if (s === "RELEASED" || s === "SETTLED_BY_VERDICT") return "released";
  if (s === "DISPUTED" || s === "ESCALATED" || s === "REMEDIATION") return "disputed";
  if (s === "REFUNDED") return "refunded";
  if (s === "DRAFT" || s === "LOCKED") return "draft";
  return "held";
}
export const msStateLabel = (s: string) => MS_STATE_LABEL[s] ?? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
