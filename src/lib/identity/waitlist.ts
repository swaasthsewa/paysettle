// F3 (waitlist) · the waitlist form's rules. Anyone may post it, so nothing is trusted:
// every field is checked with zod, a hidden field catches robots, and the e-mail is stored lower-cased so the
// unique index on waitlist.email answers "already on the list" for any spelling of the same address.
import { z } from "zod";

export const WAITLIST_ROLES = ["provider", "client", "both", "platform", "other"] as const;
export type WaitlistRole = (typeof WAITLIST_ROLES)[number];
export const WAITLIST_MAX = { email: 254, note: 500 } as const;
/** The hidden field. People never see it; a form-filling robot usually fills it. */
export const HONEYPOT = "website";

export const waitlistSchema = z.object({
  email: z.string().trim().toLowerCase().max(WAITLIST_MAX.email).pipe(z.email()),
  role: z.enum(WAITLIST_ROLES),
  note: z.string().trim().max(WAITLIST_MAX.note).optional().transform((v) => (v ? v : undefined)),
});
export type WaitlistEntry = z.infer<typeof waitlistSchema>;

export type WaitlistRead =
  | { ok: true; robot: boolean; data: WaitlistEntry }
  | { ok: false; fields: ("email" | "role" | "note")[] };

/** Read a posted form or JSON body. A robot (honeypot filled) reads as ok with robot=true: it is told all went well and nothing is stored. */
export function readWaitlist(input: Record<string, unknown>): WaitlistRead {
  const trap = input[HONEYPOT];
  const robot = typeof trap === "string" && trap.trim().length > 0;
  const r = waitlistSchema.safeParse({
    email: typeof input.email === "string" ? input.email : "",
    role: input.role,
    note: typeof input.note === "string" ? input.note : undefined,
  });
  if (!r.success) {
    if (robot) return { ok: true, robot: true, data: { email: "robot@invalid.example", role: "other", note: undefined } };
    const fields = [...new Set(r.error.issues.map((i) => String(i.path[0])))].filter((f): f is "email" | "role" | "note" => f === "email" || f === "role" || f === "note");
    return { ok: false, fields };
  }
  return { ok: true, robot, data: r.data };
}
