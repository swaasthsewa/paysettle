/**
 * Chargeback demo data (F4.10), idempotent: a PayPal chargeback on a finished demo contract ("Marketing site rebuild",
 * tranche ws_demo_done_tr1, already CLOSED, so pausing its releases changes nothing). It goes through the real webhook
 * path (sandbox simulation header): releases blocked, internal dispute superseded if any, dossier built and sent on the
 * mock rail. Re-running is a no-op (same transmission id → duplicate). Refused when PAYSETTLE_ENV=production.
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/seed-chargeback.ts
 */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { tranches } from "../src/db/schema";
import { representments } from "../src/db/schema-representment";
import { sandboxMode } from "../src/lib/clock";
import { ingestPaypalWebhook } from "../src/server/money/webhook";

const TRANCHE = "ws_demo_done_tr1";
const DISPUTE = "PP-D-DEMO-4821";
const TRANSMISSION = "seed-x2-chargeback-1";

async function main() {
  if (!sandboxMode()) throw new Error("seed-chargeback is sandbox-only (P9)");
  const [t] = await db.select().from(tranches).where(eq(tranches.id, TRANCHE)).limit(1);
  if (!t) { console.log(`seed-chargeback: ${TRANCHE} not found (run seed-money first); nothing to do`); return; }
  if (t.state !== "CLOSED") { console.log(`seed-chargeback: ${TRANCHE} is ${t.state}, not CLOSED; skipped so no live demo tranche is paused`); return; }
  const body = JSON.stringify({
    id: `WH-${TRANSMISSION}`, event_type: "CUSTOMER.DISPUTE.CREATED", create_time: new Date().toISOString(), summary: "A buyer opened a dispute",
    resource: { dispute_id: DISPUTE, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status: "WAITING_FOR_SELLER_RESPONSE", disputed_transactions: [{ seller_transaction_id: t.authorizationId ?? t.paypalOrderId }], dispute_amount: { currency_code: "USD", value: (t.amountCents / 100).toFixed(2) } },
  });
  const r = await ingestPaypalWebhook(body, new Headers({ "paypal-transmission-id": TRANSMISSION, "content-type": "application/json", "x-paysettle-sim": "1" }));
  const [row] = await db.select().from(representments).where(eq(representments.disputeId, DISPUTE)).limit(1);
  console.log(`seed-chargeback: webhook ${r.state}; representment ${row ? `${row.id} ${row.status}${row.lastError ? ` (${row.lastError})` : ""}` : "not created"}`);
}
if (process.argv[1]?.endsWith("seed-chargeback.ts")) main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
