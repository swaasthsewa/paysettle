import { launch, as, close, shot, loadState, saveState, appendMs, editMs, signRev, room, mainText } from "./lib.mjs";
await launch();
const st = loadState(); const ws = st.p1;
const dan = await as("dan"), arjun = await as("arjun");
// Arjun (provider) appends two features planned for later weeks; both will be carried if not started by day 21
await appendMs(arjun, ws, { title: "In-app chat between client and provider", day: 23, share: 12, artifact: "VIDEO", note: "Walkthrough of chat on web, Android and iOS (sample)", criteria: ["Client and provider can exchange messages inside a contract", "Messages are kept with the contract audit trail"], lock: "Client approves the walkthrough.", dispute: "Missing platforms are listed; fix within 72 hours." });
await appendMs(arjun, ws, { title: "Offline mode for the mobile apps", day: 25, share: 8, artifact: "VIDEO", note: "Airplane-mode walkthrough (sample)", criteria: ["Contract and milestone screens open without a network", "Queued actions sync when the network returns"] });
for (const [c, s] of [["M02", 12], ["M03", 16], ["M04", 20], ["M05", 12], ["M06", 12], ["M07", 8]]) await editMs(arjun, ws, c, { share: s });
await room(arjun, ws);
await shot(arjun, "w01-provider-negotiation-room");
console.log((await mainText(arjun)).match(/Policy gate[\s\S]{0,200}/)?.[0]);
await signRev(arjun, ws);
await room(dan, ws);
await shot(dan, "w01-client-review-before-signing");
await signRev(dan, ws);
await room(dan, ws);
await shot(dan, "w01-client-signed-locked");
console.log((await mainText(dan)).slice(0, 900));
await close();
