import { as, room, shot, settle, mainText, q } from "./lib.mjs";
/** Proposes a change order through the contract room form, then the other party reviews and both sign. */
export async function changeOrder(ws, { by = "arjun", note, edits = {}, remove = [], add = [], prefix, tag }) {
  const p = await as(by), other = await as(by === "arjun" ? "dan" : "arjun");
  await room(p, ws);
  const f = p.getByTestId("co-propose");
  await f.evaluate((e) => e.querySelectorAll("details").forEach((d) => (d.open = true)));
  if (await f.evaluate((e) => e.tagName) === "DETAILS") await f.evaluate((e) => (e.open = true));
  await p.fill("#co-note", note);
  for (const [code, e] of Object.entries(edits)) {
    if (e.title) await p.fill(`#co-t-${code}`, e.title);
    if (e.day) await p.fill(`#co-d-${code}`, String(e.day));
    if (e.amount) await p.fill(`#co-a-${code}`, e.amount);
    if (e.proof) await p.fill(`#co-p-${code}`, e.proof);
    if (e.criteria) await p.fill(`#co-c-${code}`, e.criteria.join("\n"));
  }
  for (const code of remove) await f.locator(`input[name=remove_${code}]`).check();
  let i = 0;
  for (const n of add) {
    i++;
    await p.fill(`#co-n${i}-title`, n.title);
    await p.fill(`#co-n${i}-day`, String(n.day));
    await p.fill(`#co-n${i}-amount`, n.amount);
    if (n.artifact) await p.selectOption(`#co-n${i}-art`, n.artifact);
    if (n.min) await p.fill(`#co-n${i}-min`, String(n.min));
    await p.fill(`#co-n${i}-crit`, n.criteria.join("\n"));
  }
  await shot(p, `${prefix}-${by === "arjun" ? "provider" : "client"}-${tag}-propose`, false);
  await Promise.all([p.waitForNavigation().catch(() => {}), f.getByRole("button", { name: "Propose change order" }).click()]);
  await settle(p);
  const rv = p.getByTestId("co-review");
  await rv.waitFor();
  const coNo = Number(/Change order (\d+)/.exec(await rv.innerText())?.[1]);
  await rv.scrollIntoViewIfNeeded();
  await shot(p, `${prefix}-${by === "arjun" ? "provider" : "client"}-${tag}-proposed`, false);
  await Promise.all([p.waitForNavigation().catch(() => {}), rv.getByRole("button", { name: `Sign change order ${coNo}` }).click()]);
  await settle(p);
  await room(other, ws);
  const orv = other.getByTestId("co-review");
  await orv.scrollIntoViewIfNeeded();
  const reviewText = await orv.innerText();
  await orv.screenshot({ path: `/home/user/paysettle/docs/simulations/paysettle-build/shots/${prefix}-${by === "arjun" ? "client" : "provider"}-${tag}-review.jpg`, type: "jpeg", quality: 80 });
  console.log(`shot ${prefix}-${tag}-review (other party)`);
  await Promise.all([other.waitForNavigation().catch(() => {}), orv.getByRole("button", { name: `Sign change order ${coNo}` }).click()]);
  await settle(other);
  const after = await mainText(other);
  console.log(`CO${coNo} review:\n${reviewText}\n---`);
  return { coNo, reviewText, after };
}
