import { launch, as, close, loadState, shot, room } from "./lib.mjs";
import { deliver } from "./evidence.mjs";
const b = await launch(); const st = loadState(); const ws = st.p2;
await deliver(b, ws, "C03", null, { prefix: "w07", shots: true, note: "Android build on the internal testing track; create, fund, approve and release journeys pass on a Pixel test device (QA). Sample screenshots." });
const dan = await as("dan"); await room(dan, ws); await shot(dan, "w07-client-period-2-room");
await close(); process.exit(0);
