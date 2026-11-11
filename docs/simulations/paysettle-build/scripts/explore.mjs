import { launch, as, dumpForms, close } from "./lib.mjs";
await launch();
const [who, url] = process.argv.slice(2);
const p = await as(who);
await p.goto(url);
console.log(p.url());
console.log(await dumpForms(p));
await close();
