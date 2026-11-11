/**
 * Deterministic mock rail for tests and the Judge Playground's fast mode (< 200 ms). Same semantics as Rail A:
 * one authorization per tranche, partial captures, refunds of captured money, void of the remainder.
 * Idempotent: repeating a call with the same key returns the first result. Chaos faults are injectable (F5.08).
 */
import { RailError, assertEvidence, type EvidenceDossier, type EvidenceRef, type FundInput, type HoldRef, type HoldState, type MoveRef, type PaypalTxn, type Rail, type ReleaseInput } from "./types";
import { sha256 } from "../ids";

interface Order { id: string; amount: number; status: HoldState["status"]; authId: string; captured: number; refunded: number; captures: string[] }
/** F4.10: what the mock "PayPal" received for a dispute (hashes and sizes only; the documents themselves are not kept). */
export interface MockEvidence { id: string; disputeId: string; idemKey: string; hash: string; evidenceType: string; notesChars: number; merchantId?: string; documents: { name: string; contentType: string; bytes: number; sha256: string }[]; at: string }
type Store = { orders: Map<string, Order>; idem: Map<string, unknown>; txns: PaypalTxn[]; faults: Set<string>; evidence?: MockEvidence[]; ineligible?: Set<string> };
const g = globalThis as unknown as { __mockRail?: Store };
const S: Store = (g.__mockRail ??= { orders: new Map<string, Order>(), idem: new Map<string, unknown>(), txns: [] as PaypalTxn[], faults: new Set<string>() });
/* stores created by an older build of this module in the same process get the evidence fields on first use */
const evidenceLog = () => (S.evidence ??= []);
const ineligible = () => (S.ineligible ??= new Set<string>());

const short = (s: string) => sha256(s).slice(0, 17).toUpperCase();
function once<T>(key: string, fn: () => T): T { if (S.idem.has(key)) return S.idem.get(key) as T; const r = fn(); S.idem.set(key, r); return r; }
function fault(name: string) { if (S.faults.has(name)) { S.faults.delete(name); throw new RailError("TRANSIENT", `PayPal 503 (injected fault: ${name})`); } }

export const mockControl = {
  inject: (f: "release_503" | "fund_503" | "refund_503" | "evidence_503") => S.faults.add(f),
  reset: () => { S.orders.clear(); S.idem.clear(); S.txns.length = 0; S.faults.clear(); evidenceLog().length = 0; ineligible().clear(); },
  txns: () => [...S.txns],
  /** F4.10: evidence submissions received, oldest first. */
  evidence: () => [...evidenceLog()],
  /** F4.10: make the mock answer as PayPal does when a dispute does not take seller evidence (no provide-evidence link). */
  closeForEvidence: (disputeId: string, closed = true) => { if (closed) ineligible().add(disputeId); else ineligible().delete(disputeId); },
};

export class MockRail implements Rail {
  readonly id = "MOCK" as const;
  async fund(i: FundInput): Promise<HoldRef> {
    fault("fund_503");
    return once(i.idemKey, () => {
      const id = "MOCKORD-" + short(i.idemKey);
      S.orders.set(id, { id, amount: i.amountCents, status: "CREATED", authId: "MOCKAUTH-" + short(id), captured: 0, refunded: 0, captures: [] });
      return { orderId: id, approveUrl: i.returnUrl + (i.returnUrl.includes("?") ? "&" : "?") + "token=" + id };
    });
  }
  async confirm(orderId: string, idemKey: string): Promise<HoldState> {
    return once(idemKey, () => {
      const o = this.get(orderId); o.status = "HELD";
      S.txns.push({ id: o.authId, type: "AUTHORIZATION", amountCents: o.amount, ref: o.id, at: new Date().toISOString() });
      return this.state(o);
    });
  }
  async release(i: ReleaseInput): Promise<MoveRef> {
    fault("release_503");
    return once(i.idemKey, () => {
      const o = this.get(i.orderId);
      if (o.status !== "HELD") throw new RailError("STATE", `authorization is ${o.status}`);
      if (o.captured + i.amountCents > o.amount) throw new RailError("BUG", "capture exceeds authorization");
      o.captured += i.amountCents;
      const id = "MOCKCAP-" + short(i.idemKey); o.captures.push(id);
      if (i.final) o.status = "COMPLETED";
      S.txns.push({ id, type: "CAPTURE", amountCents: i.amountCents, ref: o.authId, at: new Date().toISOString() });
      return { id, status: "COMPLETED" as const };
    });
  }
  async refund(captureId: string, amountCents: number, _c: string, idemKey: string): Promise<MoveRef> {
    fault("refund_503");
    return once(idemKey, () => {
      const o = [...S.orders.values()].find((x) => x.captures.includes(captureId) || x.authId === captureId);
      if (!o) throw new RailError("STATE", "unknown capture");
      if (o.refunded + amountCents > o.captured) throw new RailError("BUG", "refund exceeds captured amount");
      o.refunded += amountCents;
      const id = "MOCKREF-" + short(idemKey);
      S.txns.push({ id, type: "REFUND", amountCents, ref: captureId, at: new Date().toISOString() });
      return { id, status: "COMPLETED" as const };
    });
  }
  async voidRemainder(authorizationId: string, idemKey: string) {
    once(idemKey, () => {
      const o = [...S.orders.values()].find((x) => x.authId === authorizationId);
      if (!o) throw new RailError("STATE", "unknown authorization");
      S.txns.push({ id: "MOCKVOID-" + short(idemKey), type: "VOID", amountCents: o.amount - o.captured, ref: authorizationId, at: new Date().toISOString() });
      o.status = "VOIDED"; return true;
    });
  }
  async extend(authorizationId: string) { return { authorizationId }; }
  /**
   * F4.10 deterministic: the reference is derived from the key, and repeating a key returns the first answer without
   * recording twice. Eligibility is checked first and not cached, like PayPal's dispute-details check.
   */
  async provideEvidence(disputeId: string, d: EvidenceDossier, idemKey: string): Promise<EvidenceRef> {
    assertEvidence(disputeId, d, idemKey);
    if (ineligible().has(disputeId)) return { id: "", status: "NOT_ELIGIBLE", note: "This dispute is not waiting for seller evidence (simulated)." };
    fault("evidence_503");
    return once(`evidence:${idemKey}`, () => {
      const id = "MOCKEVID-" + short(idemKey);
      evidenceLog().push({
        id, disputeId, idemKey, hash: d.hash, evidenceType: d.evidenceType, notesChars: d.notes.length, merchantId: d.merchantId,
        documents: d.documents.map((x) => ({ name: x.name, contentType: x.contentType, bytes: x.bytes.byteLength, sha256: x.sha256 })), at: new Date().toISOString(),
      });
      return { id, status: "SUBMITTED" as const };
    });
  }
  async status(orderId: string) { return this.state(this.get(orderId)); }
  async transactions() { return [...S.txns]; }
  private get(id: string) { const o = S.orders.get(id); if (!o) throw new RailError("STATE", `unknown order ${id}`); return o; }
  private state(o: Order): HoldState { return { status: o.status, authorizationId: o.authId, heldCents: o.amount - o.captured, capturedCents: o.captured }; }
}
