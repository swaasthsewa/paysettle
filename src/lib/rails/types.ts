/** The rail interface. Every money movement goes through a Rail (P1); every call carries an idempotency key (P2). */
export type RailId = "A1" | "A2" | "B" | "MOCK";
export interface FundInput { trancheId: string; amountCents: number; currency: string; payeeEmail?: string; payeeMerchantId?: string; description: string; returnUrl: string; cancelUrl: string; feeCents?: number; idemKey: string }
export interface HoldRef { orderId: string; approveUrl: string }
export interface HoldState { status: "CREATED" | "APPROVED" | "HELD" | "VOIDED" | "COMPLETED" | "EXPIRED"; authorizationId?: string; captureId?: string; heldCents: number; capturedCents: number; expiresAt?: string }
export interface ReleaseInput { /** A2 only: amount paid out to the provider (net of fee). Defaults to amountCents. */ payoutCents?: number; orderId: string; authorizationId?: string; captureId?: string; amountCents: number; currency: string; final: boolean; payeeEmail?: string; idemKey: string; note: string }
export interface MoveRef { id: string; status: "COMPLETED" | "PENDING" }
export interface PaypalTxn { id: string; type: "AUTHORIZATION" | "CAPTURE" | "REFUND" | "PAYOUT" | "VOID"; amountCents: number; ref: string; at: string }
/**
 * F4.10 representment: the evidence PaySettle sends to PayPal when a buyer opens a PayPal dispute on a held or released
 * payment. Not a money movement, but it goes through the rail (P1) with a stored idempotency key (P2), like every call.
 * PayPal's provide-evidence call takes multipart/form-data: an `input` JSON part ({ evidences: [...] }) and file parts.
 */
export type EvidenceType = "PROOF_OF_FULFILLMENT" | "PROOF_OF_REFUND" | "OTHER";
export interface EvidenceDocument { name: string; contentType: "application/pdf" | "image/png" | "image/jpeg"; bytes: Uint8Array; sha256: string }
export interface EvidenceDossier {
  /** SHA-256 of the canonical dossier JSON the documents were built from (stored with the representment). */
  hash: string;
  evidenceType: EvidenceType;
  /** Plain-text summary for PayPal's notes field (cut to EVIDENCE_LIMITS.notesChars). */
  notes: string;
  documents: EvidenceDocument[];
  /** A1/B: the provider's PayPal merchant id; the call is made on the merchant's behalf (PayPal-Auth-Assertion). */
  merchantId?: string;
}
export interface EvidenceRef { id: string; status: "SUBMITTED" | "NOT_ELIGIBLE"; note?: string }
/**
 * Conservative limits applied before any call. PayPal's dispute document rules live on its "Supported file types and
 * sizes" page, which was not reachable when this was written; these are the commonly published limits (PDF/JPG/PNG,
 * 10 MB a file, 50 MB a request). Tighten here if PayPal's page says otherwise.
 */
export const EVIDENCE_LIMITS = { notesChars: 2000, fileBytes: 10 * 1024 * 1024, totalBytes: 50 * 1024 * 1024, files: 10, disputeId: /^[A-Za-z0-9-]{1,255}$/ } as const;

export class RailError extends Error {
  constructor(readonly kind: "TRANSIENT" | "BUYER_ACTION" | "PAYEE_PROBLEM" | "STATE" | "BUG", message: string, readonly detail?: unknown) { super(message); }
}
export interface Rail {
  readonly id: RailId;
  fund(i: FundInput): Promise<HoldRef>;
  confirm(orderId: string, idemKey: string): Promise<HoldState>;
  release(i: ReleaseInput): Promise<MoveRef>;
  refund(captureId: string, amountCents: number, currency: string, idemKey: string, reason: string): Promise<MoveRef>;
  voidRemainder(authorizationId: string, idemKey: string): Promise<void>;
  extend(authorizationId: string, amountCents: number, currency: string, idemKey: string): Promise<{ authorizationId: string }>;
  status(orderId: string): Promise<HoldState>;
  transactions(sinceIso: string, untilIso: string): Promise<PaypalTxn[]>;
  /** Plane C read per order (Payments API): what PayPal holds for orders this platform created, whoever the payee is. */
  orderTransactions?(orderIds: string[]): Promise<PaypalTxn[]>;
  /** F4.10: send the evidence dossier for a PayPal dispute. Same key → same result (P2). Never moves money. */
  provideEvidence(disputeId: string, dossier: EvidenceDossier, idemKey: string): Promise<EvidenceRef>;
}

/** Checks a dossier against EVIDENCE_LIMITS; throws RailError("BUG") before anything is sent. Shared by every rail. */
export function assertEvidence(disputeId: string, d: EvidenceDossier, idemKey: string): void {
  if (!idemKey) throw new RailError("BUG", "provideEvidence needs an idempotency key (P2)");
  if (!EVIDENCE_LIMITS.disputeId.test(disputeId)) throw new RailError("BUG", "dispute id has characters PayPal does not accept");
  if (!d.documents.length) throw new RailError("BUG", "an evidence submission needs at least one document");
  if (d.documents.length > EVIDENCE_LIMITS.files) throw new RailError("BUG", `at most ${EVIDENCE_LIMITS.files} documents per submission`);
  let total = 0;
  for (const doc of d.documents) {
    if (doc.bytes.byteLength > EVIDENCE_LIMITS.fileBytes) throw new RailError("BUG", `${doc.name} is larger than ${EVIDENCE_LIMITS.fileBytes / 1024 / 1024} MB`);
    total += doc.bytes.byteLength;
  }
  if (total > EVIDENCE_LIMITS.totalBytes) throw new RailError("BUG", "documents are larger than PayPal accepts in one submission");
}
