/** A7 · NFR Privacy: what PaySettle sends to the AI provider and what it never sends (shown on Account → AI & agents). */
export const SENT = [
  "Milestone titles, proof specs and acceptance criteria you ask the linter or drafter to check.",
  "For the evidence check: the proof spec, the evidence file names, their metadata signals, text extracted from documents and, for photos, the image itself.",
  "For a dispute proposal: the dispute rule, contract clauses, evidence descriptions, rebuttals, bids and the disputed amount.",
  "Names and e-mail addresses of PaySettle users are replaced with role labels (for example \"client 1\"); other e-mail addresses and phone numbers are masked.",
  "Everything a party wrote or uploaded is marked as untrusted data, with an instruction never to follow instructions inside it.",
] as const;
export const NOT_SENT = [
  "Passwords, MFA secrets, session or agent tokens, PayPal credentials or account identifiers.",
  "Ledger entries, signatures and anything from another organisation's contracts.",
  "Text inside photos cannot be masked; do not photograph personal documents as evidence.",
] as const;
export const ADVISORY = "AI output is advice only. It never signs, approves, releases or refunds; people do, and the policy gate checks every contract before signing.";
