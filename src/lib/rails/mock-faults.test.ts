/**
 * F5.08 chaos on the shared mock rail: a PayPal 503 armed for one playground run fires once, only on a call about that
 * run's tranche, order or authorization, so judges running at the same time never get each other's faults. An unscoped
 * fault (the money tests use it) still fires on the next call of its kind.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MockRail, mockControl } from "./mock";

const rail = new MockRail();
beforeEach(() => mockControl.reset());

async function held(tr: string) {
  const h = await rail.fund({ trancheId: tr, amountCents: 1000, currency: "USD", description: "t", returnUrl: "http://x/r", cancelUrl: "http://x/c", idemKey: `fund-${tr}` });
  const s = await rail.confirm(h.orderId, `confirm-${tr}`);
  return { orderId: h.orderId, authorizationId: s.authorizationId! };
}
const capture = (o: { orderId: string; authorizationId: string }, key: string) => rail.release({ ...o, amountCents: 400, currency: "USD", final: false, idemKey: key, note: "n" });
const captures = (auth: string) => mockControl.txns().filter((x) => x.type === "CAPTURE" && x.ref === auth);

describe("F5.08 scoped faults on the shared mock rail", () => {
  it("F5.08 a release 503 for run A leaves run B alone and fires once on A; the retry gives exactly one capture", async () => {
    const a = await held("tr_fault_a"), b = await held("tr_fault_b");
    mockControl.inject("release_503", ["tr_fault_a", a.orderId, a.authorizationId]);
    await expect(capture(b, "rel-b")).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(capture(a, "rel-a")).rejects.toMatchObject({ kind: "TRANSIENT" });
    await expect(capture(a, "rel-a")).resolves.toMatchObject({ status: "COMPLETED" });
    expect(captures(a.authorizationId)).toHaveLength(1);
    expect(captures(b.authorizationId)).toHaveLength(1);
  });

  it("F5.08 a release 503 scoped to a tranche id also fires for an order funded after it was armed", async () => {
    mockControl.inject("release_503", "tr_fault_late");
    const late = await held("tr_fault_late");
    await expect(capture(late, "rel-late")).rejects.toMatchObject({ kind: "TRANSIENT" });
    await expect(capture(late, "rel-late")).resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("F5.08 fund and refund 503s follow their own tranche", async () => {
    mockControl.inject("fund_503", "tr_fault_c");
    await expect(held("tr_fault_d")).resolves.toBeTruthy();
    await expect(held("tr_fault_c")).rejects.toMatchObject({ kind: "TRANSIENT" });
    const c = await held("tr_fault_c");
    const cap = await capture(c, "rel-c");
    mockControl.inject("refund_503", ["tr_fault_c"]);
    await expect(rail.refund(cap.id, 100, "USD", "ref-c")).rejects.toMatchObject({ kind: "TRANSIENT" });
    await expect(rail.refund(cap.id, 100, "USD", "ref-c")).resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("F5.08 an unscoped fault fires on the next call of its kind, whoever makes it", async () => {
    const e = await held("tr_fault_e");
    mockControl.inject("release_503");
    await expect(capture(e, "rel-e")).rejects.toMatchObject({ kind: "TRANSIENT" });
    await expect(capture(e, "rel-e")).resolves.toMatchObject({ status: "COMPLETED" });
  });
});
