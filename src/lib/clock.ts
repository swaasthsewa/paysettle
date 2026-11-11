/**
 * Virtual clock. Every timer reads time through here; the Judge Playground moves a sprint's clock
 * by an offset without touching real time. Offsets are refused outside sandbox mode (P9).
 */
export const HOUR = 3_600_000, DAY = 24 * HOUR;
export function nowFor(offsetHours = 0, real: number = Date.now()): Date {
  if (offsetHours !== 0 && !sandboxMode()) throw new Error("time travel is sandbox-only (P9)");
  return new Date(real + offsetHours * HOUR);
}
export const sandboxMode = () => (process.env.PAYSETTLE_ENV ?? "sandbox") !== "production";
export const addHours = (d: Date, h: number) => new Date(d.getTime() + h * HOUR);
export const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY;
