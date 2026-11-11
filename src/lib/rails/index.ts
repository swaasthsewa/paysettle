import { MockRail } from "./mock";
import { PayPalRail } from "./paypal";
import type { Rail, RailId } from "./types";
export * from "./types";
/** The rail for a contract. MOCK when PayPal credentials are absent or the playground runs in fast mode. */
export function railFor(id: RailId, mode: "LIVE" | "MOCK" = "LIVE"): Rail {
  if (id === "MOCK" || mode === "MOCK" || !process.env.PAYPAL_CLIENT_ID) return new MockRail();
  return new PayPalRail(id);
}
export const liveAvailable = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
