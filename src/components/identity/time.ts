/** F3.06 · durations for review clocks: "2 d 4 h", "3 h 20 min", "12 min"; negative values read as overdue. Client-safe. */
export function span(ms: number): string {
  const abs = Math.abs(ms), m = Math.floor(abs / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return `${d} d ${h % 24} h`;
  if (h >= 1) return `${h} h ${m % 60} min`;
  return `${Math.max(1, m)} min`;
}
export const dueText = (ms: number) => (ms >= 0 ? `${span(ms)} left` : `overdue by ${span(ms)}`);
