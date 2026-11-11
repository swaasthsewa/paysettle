/** F1.3 · dates, durations and money in the person's own time zone and currency. Server-safe. */
import { formatCents } from "@/lib/money";
import { isTimeZone } from "@/lib/identity/profile";

export const tzOf = (profile: unknown) => {
  const tz = (profile as { timezone?: unknown } | null)?.timezone;
  return typeof tz === "string" && isTimeZone(tz) ? tz : "UTC";
};

export function when(d: Date | null | undefined, tz = "UTC"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export { dueText, span } from "./time";

export const cents = (c: number, currency = "USD") => formatCents(c, currency);
