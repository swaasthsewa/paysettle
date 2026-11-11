import { launch, as, shot, shotEl, dump, msIds, sleep, errs, travel, submitEvidence, approve } from "./lib.mjs";
import fs from "node:fs";
const ws = fs.readFileSync("ws.txt", "utf8"); const M = msIds();
const b = await launch();
const me = await as("Meera"), pr = await as("Priya"), al = await as("Alex");
const step = async (code, files, note, shotSub, shotApp, extra = {}) => {
  await submitEvidence(me, ws, M[code], files, note, { shotName: shotSub });
  await approve(pr, ws, M[code], code, extra.pre ?? null, shotApp);
};
// day 19 already reached
await travel(al, 24); // day 20
await step("M05", ["M06-monument-tickets.pdf", "M06-guide-delhi.pdf", "M06-guide-agra.pdf", "M06-guide-jaipur.pdf", "M06-guide-varanasi.pdf", "M06-monument-tickets-text-copy.txt", "M06-guide-delhi-text-copy.txt", "M06-guide-agra-text-copy.txt", "M06-guide-jaipur-text-copy.txt", "M06-guide-varanasi-text-copy.txt"], "Guides (English) for Delhi, Agra, Jaipur and Varanasi plus monument tickets (sample data).", "11-week4-provider-submit-guides-monuments", "11-week4-client-approve-guides-monuments", { pre: "11-week4-client-review-guides-ai" });
await step("C03", ["C03-cooking-class.pdf", "C03-cooking-class-text-copy.txt"], "Cooking class confirmed (sample data).", null, "11-week4-client-approve-cooking-class");
await step("M06", ["M04-insurance.pdf", "M04-evisa.pdf", "M04-insurance-text-copy.txt", "M04-evisa-text-copy.txt"], "Insurance certificate and e-visa approvals (sample data).", "11-week4-provider-submit-insurance-evisa", "11-week4-client-approve-insurance-gate");
await travel(al, 24); // day 21
await step("M07", ["M08-travel-pack.pdf", "M08-travel-pack-text-copy.txt"], "Travel pack delivered; Priya acknowledged receipt in writing (sample data).", "11-week4-provider-submit-travel-pack", "11-week4-client-approve-travel-pack");
await travel(al, 24); // day 22
await step("M08", ["M09-final-statement.pdf", "M09-final-statement-text-copy.txt"], "Close-out: every supplier paid; Jaipur room difference settled by the mediator's verdict. Priya signed the close-out (sample data).", "11-week4-provider-submit-close-out", "11-week4-client-approve-close-out");
await pr.goto(`/contracts/${ws}`); await shot(pr, "12-final-client-contract");
await me.goto(`/contracts/${ws}`); await shot(me, "12-final-provider-contract");
await me.goto(`/provider/payouts`); await shot(me, "12-final-provider-payouts");
await pr.goto(`/client/receipts`); await shot(pr, "12-final-client-receipts");
await pr.goto(`/notifications`); await shot(pr, "12-final-client-notifications");
await me.goto(`/notifications`); await shot(me, "12-final-provider-notifications");
console.log((await pr.locator("main").innerText().catch(() => "")).slice(0, 1500));
await b.close();
