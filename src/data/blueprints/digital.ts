import type { BlueprintClause, BlueprintMilestone } from "@/db/schema";
export interface BlueprintDef { code: string; title: string; vertical: string; kind: "DIGITAL" | "PHYSICAL_SHOP" | "PHYSICAL_SITE" | "HYBRID"; summary: string; recommendedDays: number; depth: "full" | "outline"; milestones: BlueprintMilestone[]; clauses: BlueprintClause[] }
const P = (kind: "IMAGE" | "VIDEO" | "PDF" | "LOG" | "LINK" | "SIGNATURE" | "ORACLE", min: number, note?: string) => ({ kind, min, note });

export const WEB_MVP: BlueprintDef = {
  code: "UC_WEB_MVP", title: "Web / SaaS MVP sprint", vertical: "Software", kind: "DIGITAL", depth: "full", recommendedDays: 26,
  summary: "A first working version of a web product: design, build, test and launch on a staging and production URL.",
  milestones: [
    { code: "M01", title: "Kickoff, access and backlog agreed", type: "GATE", day: 2, bps: 0, proof: { artifacts: [P("PDF", 1, "Signed backlog with acceptance criteria"), P("LINK", 1, "Repository invite")], criteria: ["Backlog lists every MVP feature with acceptance criteria", "Client grants repository and hosting access"] }, lockRule: "Both parties sign the backlog.", disputeRule: "Client delay in access extends all dates day for day." },
    { code: "M02", title: "Clickable design approved", type: "PAY", day: 6, bps: 1500, proof: { artifacts: [P("LINK", 1, "Prototype URL"), P("PDF", 1, "Screen list")], criteria: ["Every backlog feature has at least one screen", "Client marks the prototype approved"] }, lockRule: "Client approves the prototype.", disputeRule: "Missing screens listed; provider adds them within 72 hours." },
    { code: "M03", title: "Data model and API on staging", type: "PAY", day: 11, bps: 2000, proof: { artifacts: [P("LINK", 1, "Staging API URL"), P("LOG", 1, "CI run with tests passing")], oracle: "GITHUB_CI", criteria: ["CI is green on the main branch", "API documentation lists every endpoint"] }, lockRule: "Client approves after the CI oracle reports green.", disputeRule: "Failing tests are fixed before release; release waits." },
    { code: "M04", title: "Core features on staging", type: "PAY", day: 17, bps: 2500, proof: { artifacts: [P("LINK", 1, "Staging URL"), P("VIDEO", 1, "Walkthrough of each feature"), P("LOG", 1, "End-to-end test report")], criteria: ["Each backlog feature works on staging as demonstrated", "End-to-end tests pass"] }, lockRule: "Client approves the walkthrough.", disputeRule: "Per-feature pro-rata if some features are missing." },
    { code: "M05", title: "Quality pass: performance, accessibility, security", type: "PAY", day: 21, bps: 1500, proof: { artifacts: [P("PDF", 1, "Lighthouse report (mobile ≥ 85)"), P("PDF", 1, "Accessibility scan with no serious issues"), P("LOG", 1, "Dependency scan")], criteria: ["Lighthouse mobile performance ≥ 85 on staging", "No serious accessibility issues", "No known critical vulnerabilities"] }, lockRule: "Client approves the reports.", disputeRule: "Each failed check listed; fix within 72 hours." },
    { code: "M06", title: "Production launch", type: "PAY", day: 24, bps: 1500, proof: { artifacts: [P("LINK", 1, "Production URL"), P("PDF", 1, "Launch checklist signed")], criteria: ["Product reachable at the production URL", "Backups and monitoring switched on"] }, lockRule: "Client signs the launch checklist.", disputeRule: "Rollback event goes to a mediator." },
    { code: "M07", title: "Handover and documentation", type: "PAY", day: 26, bps: 1000, proof: { artifacts: [P("PDF", 1, "Runbook and README"), P("VIDEO", 1, "Knowledge-transfer recording")], criteria: ["Runbook covers deploy, rollback and secrets", "Client confirms ownership of all accounts"] }, lockRule: "Client signs the handover.", disputeRule: "Missing items deducted per item." },
  ],
  clauses: [
    { code: "TPL_IP", category: "BASELINE", title: "Ownership of code", body: "On each release, the client owns the code delivered in that milestone.", protective: true },
    { code: "TPL_CHANGE", category: "BASELINE", title: "Change requests", body: "New features after M01 are priced as change requests and added to a later tranche.", protective: true },
    { code: "TPL_WARRANTY", category: "BASELINE", title: "30-day bug warranty", body: "The provider fixes defects against the agreed acceptance criteria for 30 days after launch.", protective: true },
    { code: "TPL_HOSTING", category: "BASELINE", title: "Hosting costs", body: "Hosting and third-party service costs are paid by the client directly.", protective: false },
  ],
};

export const CONSULTING_SPRINT: BlueprintDef = {
  code: "UC_CONSULTING_SPRINT", title: "Enterprise software consulting sprint", vertical: "Consulting (ERP / planning)", kind: "DIGITAL", depth: "full", recommendedDays: 24,
  summary: "A fixed-scope ERP or planning-system sprint: assess, design, configure, test, go live and hand over.",
  milestones: [
    { code: "M01", title: "System access and kickoff", type: "GATE", day: 2, bps: 0, proof: { artifacts: [P("PDF", 1, "Kickoff minutes"), P("SIGNATURE", 1, "Access confirmation")], criteria: ["Consultant has access to all systems in scope"] }, lockRule: "Both sign the minutes.", disputeRule: "Client delay extends dates day for day." },
    { code: "M02", title: "Current-state assessment", type: "PAY", day: 5, bps: 1000, proof: { artifacts: [P("PDF", 1, "Assessment report ≥ 10 pages"), P("PDF", 1, "Process list")], criteria: ["Every process in scope is described", "Gaps are listed with impact"] }, lockRule: "Client approves the report.", disputeRule: "Missing sections listed; fix within 72 hours." },
    { code: "M03", title: "Solution design sign-off", type: "PAY", day: 8, bps: 1500, proof: { artifacts: [P("PDF", 1, "Design document"), P("SIGNATURE", 1, "Design approval")], criteria: ["Design covers every gap in M02", "Client signs the design"] }, lockRule: "Client signs the design.", disputeRule: "Scope disputes become change requests." },
    { code: "M04", title: "Change requests frozen", type: "GATE", day: 9, bps: 0, proof: { artifacts: [P("PDF", 1, "Change-request log snapshot")], criteria: ["No open change requests for this tranche"] }, lockRule: "Both sign.", disputeRule: "New requests move to the next tranche." },
    { code: "M05", title: "Configuration complete", type: "PAY", day: 14, bps: 2000, proof: { artifacts: [P("PDF", 1, "Transport list"), P("IMAGE", 3, "Configuration screenshots"), P("LOG", 1, "Unit test log")], criteria: ["Every design item is configured", "Unit tests pass"] }, lockRule: "Client approves.", disputeRule: "Failed tests listed; fix within 72 hours." },
    { code: "M06", title: "Integration test passed", type: "PAY", day: 17, bps: 1500, proof: { artifacts: [P("PDF", 1, "Test cases with ≥ 95% passed"), P("PDF", 1, "Defect log")], criteria: ["≥ 95% of integration test cases pass", "No open severity-1 defects"] }, lockRule: "Client approves.", disputeRule: "Open severity-1 defects block release." },
    { code: "M07", title: "User acceptance test", type: "PAY", day: 20, bps: 1500, proof: { artifacts: [P("SIGNATURE", 1, "UAT sign-off by named users")], criteria: ["Named key users sign the UAT scripts"] }, lockRule: "Client signs.", disputeRule: "Partial UAT: pro-rata by scripts passed." },
    { code: "M08", title: "Cutover and go-live", type: "PAY", day: 22, bps: 1500, proof: { artifacts: [P("PDF", 1, "Cutover checklist"), P("LOG", 1, "First-run report")], criteria: ["Cutover checklist complete", "First production run succeeded"] }, lockRule: "Client approves.", disputeRule: "A rollback goes to a mediator." },
    { code: "M09", title: "Hypercare and handover", type: "PAY", day: 24, bps: 1000, proof: { artifacts: [P("PDF", 1, "Hypercare log"), P("VIDEO", 1, "Knowledge-transfer recording")], criteria: ["All hypercare tickets closed or handed over"] }, lockRule: "Client signs the handover.", disputeRule: "Unclosed tickets: per-ticket deduction." },
  ],
  clauses: [
    { code: "TPL_CONF", category: "BASELINE", title: "Confidentiality", body: "Client data seen during the sprint stays confidential and is not copied outside client systems.", protective: true },
    { code: "TPL_CR", category: "BASELINE", title: "Change requests", body: "Work outside the signed design is a change request with its own price and milestone.", protective: true },
    { code: "TPL_TRAVEL", category: "BASELINE", title: "Travel", body: "Travel, if any, is agreed in advance and paid by the client at cost.", protective: false },
  ],
};
