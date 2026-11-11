import { launch, as, close, shot, loadState, fundTranche, room, mainText, q } from "./lib.mjs";
export async function fund(ws, n, prefix) {
  const dan = await as("dan");
  await fundTranche(dan, ws, n);
  await shot(dan, `${prefix}-client-fund-tranche-${n}`, false);
  await dan.getByRole("button", { name: /Fund with PayPal|Continue to PayPal/ }).click();
  for (let i = 0; i < 60; i++) { const [t] = await q("select state from tranches where workspace_id=$1 and idx=$2", [ws, Number(n)]); if (t?.state === "HELD") break; await new Promise((r) => setTimeout(r, 1000)); }
  await dan.waitForTimeout(1500);
  await room(dan, ws);
  const [t] = await q("select state, amount_cents from tranches where workspace_id=$1 and idx=$2", [ws, Number(n)]);
  console.log("tranche", ws, n, t);
  return t;
}
if (process.argv[1].endsWith("s03-fund.mjs")) { await launch(); const [key, n, prefix] = process.argv.slice(2); await fund(loadState()[key], n, prefix); await close(); process.exit(0); }
