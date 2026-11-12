/**
 * PayPal REST rail. One class serves A1 (payee = provider merchant), A2 (payee = PaySettle,
 * then Payouts — sandbox only, refused in production by P1) and B (delayed disbursement, behind a flag).
 * Every request sends PayPal-Request-Id = the deterministic idempotency key (P2). Exact behaviour per variant is
 * confirmed by the Day-0 spike and recorded as fixtures (tests/fixtures/paypal).
 */
import { RailError, EVIDENCE_LIMITS, assertEvidence, type EvidenceDossier, type EvidenceRef, type FundInput, type HoldRef, type HoldState, type MoveRef, type PaypalTxn, type Rail, type RailId, type ReleaseInput } from "./types";

const API = () => (process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
const dollars = (c: number) => (c / 100).toFixed(2);
const toCents = (v: string | undefined) => Math.round(Number(v ?? "0") * 100);

let token: { value: string; until: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until - 60_000) return token.value;
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new RailError("BUG", "PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set");
  const r = await fetch(`${API()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!r.ok) throw new RailError(r.status >= 500 ? "TRANSIENT" : "BUG", `PayPal token request failed (${r.status})`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, until: Date.now() + j.expires_in * 1000 };
  return token.value;
}

/** Maps a PayPal error answer to a RailError kind (shared by JSON and multipart calls). */
function railErrorFor(status: number, path: string, json: { details?: { issue?: string }[]; name?: string } & Record<string, unknown>): RailError {
  const issue: string = json?.details?.[0]?.issue ?? json?.name ?? "";
  if (status >= 500 || status === 429) return new RailError("TRANSIENT", `PayPal ${status} on ${path}`, json);
  if (/INSTRUMENT_DECLINED|PAYER_ACTION_REQUIRED|ORDER_NOT_APPROVED/.test(issue)) return new RailError("BUYER_ACTION", issue, json);
  if (/PAYEE|RECEIVER|MERCHANT/.test(issue)) return new RailError("PAYEE_PROBLEM", issue, json);
  if (/EXPIRED|ALREADY|VOIDED|CAPTURED|AUTHORIZATION|NOT_ELIGIBLE|INVALID_DISPUTE_STATUS|CANNOT_PROVIDE_EVIDENCE/.test(issue)) return new RailError("STATE", issue, json);
  return new RailError("BUG", `PayPal ${status} ${issue || ""} on ${path}`, json);
}
const parse = (text: string) => { try { return text ? JSON.parse(text) : {}; } catch { return { raw: text.slice(0, 500) }; } };

export async function pp<T>(method: string, path: string, body?: unknown, idemKey?: string, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", Prefer: "return=representation", ...extraHeaders };
  if (idemKey) headers["PayPal-Request-Id"] = idemKey;
  let r: Response;
  try { r = await fetch(`${API()}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new RailError("TRANSIENT", `network error calling PayPal ${path}`, String(e)); }
  const json = parse(await r.text());
  if (r.ok) return json as T;
  throw railErrorFor(r.status, path, json);
}

/**
 * PayPal-Auth-Assertion for a call made on a merchant's behalf (platform partner pattern): an unsigned JWT
 * {"alg":"none"} with iss = our client id and payer_id = the merchant's id. Only sent when a merchant id is known.
 */
export function authAssertion(merchantId: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ iss: process.env.PAYPAL_CLIENT_ID ?? "", payer_id: merchantId })}.`;
}

/**
 * F4.10 provide-evidence request (developer.paypal.com, Disputes API v1 "Provide evidence" and the Disputes integration
 * guide): POST /v1/customer/disputes/{id}/provide-evidence, multipart/form-data with an `input` part holding JSON
 * { evidences: [{ evidence_type, notes, documents: [{ name }] }] } and one part per file (file1, file2, …).
 * Exported so the request shape is unit-tested without the network.
 */
export function evidenceForm(d: EvidenceDossier): FormData {
  const input = { evidences: [{ evidence_type: d.evidenceType, notes: d.notes.slice(0, EVIDENCE_LIMITS.notesChars), documents: d.documents.map((x) => ({ name: x.name })) }] };
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }), "input.json");
  d.documents.forEach((x, i) => form.append(`file${i + 1}`, new Blob([x.bytes as Uint8Array<ArrayBuffer>], { type: x.contentType }), x.name));
  return form;
}

interface OrderResp { id: string; status: string; links?: { rel: string; href: string }[]; purchase_units?: { payments?: { authorizations?: { id: string; status: string; amount: { value: string }; expiration_time?: string }[]; captures?: { id: string; status: string; amount: { value: string } }[] } }[] }

export class PayPalRail implements Rail {
  constructor(readonly id: Exclude<RailId, "MOCK">) {
    if (id === "A2" && process.env.PAYSETTLE_ENV === "production") throw new Error("Rail A2 is custodial and sandbox-only (P1)");
  }
  async fund(i: FundInput): Promise<HoldRef> {
    const unit: Record<string, unknown> = { reference_id: i.trancheId, custom_id: i.trancheId, description: i.description.slice(0, 127), amount: { currency_code: i.currency, value: dollars(i.amountCents) } };
    if (this.id === "A1" && (i.payeeMerchantId || i.payeeEmail)) unit.payee = i.payeeMerchantId ? { merchant_id: i.payeeMerchantId } : { email_address: i.payeeEmail };
    if (this.id === "B") unit.payment_instruction = { disbursement_mode: "DELAYED", ...(i.feeCents ? { platform_fees: [{ amount: { currency_code: i.currency, value: dollars(i.feeCents) } }] } : {}) };
    if (this.id === "B" && i.payeeMerchantId) unit.payee = { merchant_id: i.payeeMerchantId };
    const o = await pp<OrderResp>("POST", "/v2/checkout/orders", {
      intent: this.id === "B" ? "CAPTURE" : "AUTHORIZE",
      purchase_units: [unit],
      payment_source: { paypal: { experience_context: { brand_name: "PaySettle", shipping_preference: "NO_SHIPPING", user_action: "CONTINUE", return_url: i.returnUrl, cancel_url: i.cancelUrl } } },
    }, i.idemKey);
    const approve = o.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    if (!approve) throw new RailError("BUG", "PayPal returned no approval link", o);
    return { orderId: o.id, approveUrl: approve };
  }
  async confirm(orderId: string, idemKey: string): Promise<HoldState> {
    const o = await pp<OrderResp>("POST", `/v2/checkout/orders/${orderId}/${this.id === "B" ? "capture" : "authorize"}`, {}, idemKey);
    return this.toState(o);
  }
  async release(i: ReleaseInput): Promise<MoveRef> {
    if (this.id === "B") {
      const r = await pp<{ item_id?: string; processing_state?: { status: string } }>("POST", "/v1/payments/referenced-payouts-items", { reference_id: i.captureId, reference_type: "TRANSACTION_ID" }, i.idemKey);
      return { id: r.item_id ?? i.idemKey, status: r.processing_state?.status === "SUCCESS" ? "COMPLETED" : "PENDING" };
    }
    if (!i.authorizationId) throw new RailError("BUG", "release needs an authorization id");
    const c = await pp<{ id: string; status: string }>("POST", `/v2/payments/authorizations/${i.authorizationId}/capture`, { amount: { currency_code: i.currency, value: dollars(i.amountCents) }, final_capture: i.final, note_to_payer: i.note.slice(0, 255), invoice_id: i.idemKey }, i.idemKey);
    if (this.id === "A2" && i.payeeEmail) {
      await pp("POST", "/v1/payments/payouts", { sender_batch_header: { sender_batch_id: i.idemKey, email_subject: "PaySettle milestone release" }, items: [{ recipient_type: "EMAIL", receiver: i.payeeEmail, amount: { currency: i.currency, value: dollars(i.payoutCents ?? i.amountCents) }, note: i.note.slice(0, 255), sender_item_id: i.idemKey }] }, i.idemKey + "-payout");
    }
    return { id: c.id, status: c.status === "COMPLETED" ? "COMPLETED" : "PENDING" };
  }
  async refund(captureId: string, amountCents: number, currency: string, idemKey: string, reason: string): Promise<MoveRef> {
    const r = await pp<{ id: string; status: string }>("POST", `/v2/payments/captures/${captureId}/refund`, { amount: { currency_code: currency, value: dollars(amountCents) }, note_to_payer: reason.slice(0, 255) }, idemKey);
    return { id: r.id, status: r.status === "COMPLETED" ? "COMPLETED" : "PENDING" };
  }
  async voidRemainder(authorizationId: string, idemKey: string) { await pp("POST", `/v2/payments/authorizations/${authorizationId}/void`, {}, idemKey); }
  async extend(authorizationId: string, amountCents: number, currency: string, idemKey: string) {
    const r = await pp<{ id: string }>("POST", `/v2/payments/authorizations/${authorizationId}/reauthorize`, { amount: { currency_code: currency, value: dollars(amountCents) } }, idemKey);
    return { authorizationId: r.id };
  }
  /**
   * F4.10: PayPal accepts seller evidence only while the dispute shows a provide-evidence link (status
   * WAITING_FOR_SELLER_RESPONSE). The details call comes first; without the link nothing is sent and the answer is
   * NOT_ELIGIBLE, so Operations can send it later. PayPal-Request-Id is not listed for this call in PayPal's reference;
   * it is sent anyway (harmless if ignored) so a retry with the same key is recognisable on both sides.
   */
  async provideEvidence(disputeId: string, d: EvidenceDossier, idemKey: string): Promise<EvidenceRef> {
    assertEvidence(disputeId, d, idemKey);
    const onBehalf = d.merchantId ? { "PayPal-Auth-Assertion": authAssertion(d.merchantId) } : undefined;
    const path = `/v1/customer/disputes/${encodeURIComponent(disputeId)}`;
    const info = await pp<{ status?: string; links?: { rel?: string; href?: string }[] }>("GET", path, undefined, undefined, onBehalf);
    const link = info.links?.find((l) => /provide[-_]evidence/i.test(l.rel ?? "") || /\/provide-evidence$/.test(l.href ?? ""));
    if (!link) return { id: "", status: "NOT_ELIGIBLE", note: `PayPal does not take seller evidence on this dispute now (status ${info.status ?? "unknown"}).` };
    const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}`, "PayPal-Request-Id": idemKey, ...onBehalf };
    let r: Response;
    try { r = await fetch(`${API()}${path}/provide-evidence`, { method: "POST", headers, body: evidenceForm(d) }); }
    catch (e) { throw new RailError("TRANSIENT", `network error calling PayPal ${path}/provide-evidence`, String(e)); }
    const json = parse(await r.text());
    if (!r.ok) throw railErrorFor(r.status, `${path}/provide-evidence`, json);
    const self = (json.links as { rel?: string; href?: string }[] | undefined)?.find((l) => l.rel === "self")?.href;
    return { id: self ?? `${disputeId}:${idemKey}`, status: "SUBMITTED" };
  }
  async status(orderId: string): Promise<HoldState> { return this.toState(await pp<OrderResp>("GET", `/v2/checkout/orders/${orderId}`)); }
  async transactions(sinceIso: string, untilIso: string): Promise<PaypalTxn[]> {
    const q = new URLSearchParams({ start_date: sinceIso, end_date: untilIso, fields: "transaction_info", page_size: "500" });
    const r = await pp<{ transaction_details?: { transaction_info: { transaction_id: string; transaction_event_code: string; transaction_amount: { value: string }; paypal_reference_id?: string; transaction_initiation_date: string } }[] }>("GET", `/v1/reporting/transactions?${q}`);
    return (r.transaction_details ?? []).map(({ transaction_info: t }) => ({
      id: t.transaction_id, type: /^T11/.test(t.transaction_event_code) ? "REFUND" : /^T00/.test(t.transaction_event_code) ? "CAPTURE" : "PAYOUT",
      amountCents: Math.abs(toCents(t.transaction_amount.value)), ref: t.paypal_reference_id ?? "", at: t.transaction_initiation_date,
    }));
  }
  /**
   * Plane C straight from the Payments API: each order's authorizations, captures, refunds and void. The platform created
   * these orders, so it can read them even when the provider is the payee (Rail A1), which the reporting feed never shows
   * the platform. Also immediate: no reporting lag. An order PayPal no longer returns is skipped (the watchdog handles it).
   */
  async orderTransactions(orderIds: string[]): Promise<PaypalTxn[]> {
    type Money = { value: string };
    type Pay = { id: string; status: string; amount: Money; create_time?: string; update_time?: string };
    const out: PaypalTxn[] = [];
    for (const oid of [...new Set(orderIds)]) {
      let o: { purchase_units?: { payments?: { authorizations?: Pay[]; captures?: Pay[]; refunds?: Pay[] } }[] };
      try { o = await pp("GET", `/v2/checkout/orders/${oid}`); } catch (e) { if (e instanceof RailError && e.kind !== "TRANSIENT") continue; throw e; }
      for (const pu of o.purchase_units ?? []) {
        const p = pu.payments ?? {};
        const auth = p.authorizations?.[0];
        const caps = (p.captures ?? []).filter((c) => ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(c.status));
        for (const a of p.authorizations ?? []) {
          out.push({ id: a.id, type: "AUTHORIZATION", amountCents: toCents(a.amount.value), ref: oid, at: a.create_time ?? a.update_time ?? "" });
          if (a.status === "VOIDED") out.push({ id: `void:${a.id}`, type: "VOID", amountCents: toCents(a.amount.value) - caps.reduce((s, c) => s + toCents(c.amount.value), 0), ref: a.id, at: a.update_time ?? a.create_time ?? "" });
        }
        for (const c of caps) out.push({ id: c.id, type: "CAPTURE", amountCents: toCents(c.amount.value), ref: auth?.id ?? oid, at: c.create_time ?? c.update_time ?? "" });
        for (const r of p.refunds ?? []) if (r.status === "COMPLETED") out.push({ id: r.id, type: "REFUND", amountCents: toCents(r.amount.value), ref: oid, at: r.create_time ?? r.update_time ?? "" });
      }
    }
    return out;
  }
  private toState(o: OrderResp): HoldState {
    const p = o.purchase_units?.[0]?.payments;
    const auth = p?.authorizations?.[0], caps = p?.captures ?? [];
    const captured = caps.filter((c) => c.status === "COMPLETED").reduce((a, c) => a + toCents(c.amount.value), 0);
    const total = auth ? toCents(auth.amount.value) : captured;
    const status: HoldState["status"] = o.status === "COMPLETED" ? (auth ? (auth.status === "VOIDED" ? "VOIDED" : "HELD") : "HELD") : o.status === "APPROVED" ? "APPROVED" : "CREATED";
    return { status, authorizationId: auth?.id, captureId: caps[0]?.id, heldCents: total - captured, capturedCents: captured, expiresAt: auth?.expiration_time };
  }
}
