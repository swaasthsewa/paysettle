/**
 * F3 · POST /api/waitlist — join the pilot waitlist. Public, so nothing is trusted (P11):
 *   · zod validation (src/lib/identity/waitlist.ts); a filled honeypot is told "joined" and nothing is stored
 *   · 5 posts per client address per 10 minutes, in memory. The address is the rightmost X-Forwarded-For hop, the one
 *     the hosting proxy appends (client-supplied hops to its left are ignored); no header → "local". See src/lib/net.ts.
 *   · the unique index on waitlist.email answers "already on the list" (no error, no second row)
 *   · an audit row without the e-mail (the chain is append-only, so no personal data goes into it)
 * JSON in, JSON out; a plain form post (no script) is redirected back to /waitlist with the answer in the query.
 * GET returns the count for the live counter.
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { waitlist } from "@/db/schema";
import { audit } from "@/lib/audit";
import { site } from "@/copy/site";
import { fixedWindow } from "@/lib/identity/rate-limit";
import { readWaitlist } from "@/lib/identity/waitlist";
import { rateLimitKey } from "@/lib/net";

const g = globalThis as unknown as { __psWaitlistLimit?: ReturnType<typeof fixedWindow> };
const limiter = (g.__psWaitlistLimit ??= fixedWindow(5, 10 * 60_000));
const t = site.waitlist.result;

async function count() { const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(waitlist); return r?.n ?? 0; }

export async function GET() {
  return NextResponse.json({ count: await count() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  const reply = (status: number, body: { ok: boolean; message: string; code: string; fields?: string[]; count?: number }, headers?: Record<string, string>) => {
    if (isJson) return NextResponse.json(body, { status, headers });
    const u = new URL("/waitlist", req.url);
    u.searchParams.set("r", body.code);
    if (body.fields?.length) u.searchParams.set("f", body.fields.join(","));
    return NextResponse.redirect(u, 303);
  };

  const ip = rateLimitKey(req.headers); // rightmost hop, set by the hosting proxy; spoofed left-hand hops cannot dodge the limit
  const gate = limiter.hit(ip, Date.now());
  if (!gate.ok) return reply(429, { ok: false, code: "limit", message: t.limit(gate.retryAfterS) }, { "retry-after": String(gate.retryAfterS) });

  let input: Record<string, unknown> = {};
  try {
    if (isJson) { const b = await req.json(); input = b && typeof b === "object" ? (b as Record<string, unknown>) : {}; }
    else input = Object.fromEntries([...(await req.formData()).entries()].filter(([, v]) => typeof v === "string"));
  } catch { input = {}; }

  const read = readWaitlist(input);
  if (!read.ok) return reply(400, { ok: false, code: "invalid", message: t.invalid, fields: read.fields });
  if (read.robot) return reply(200, { ok: true, code: "joined", message: t.joined });

  try {
    const rows = await db.insert(waitlist).values({ email: read.data.email, role: read.data.role, note: read.data.note ?? null })
      .onConflictDoNothing({ target: waitlist.email }).returning({ id: waitlist.id });
    if (rows.length === 0) return reply(200, { ok: true, code: "already", message: t.already, count: await count() });
    await audit(db, { id: null, role: "public" }, "waitlist.join", `waitlist:${rows[0].id}`, { role: read.data.role, note: Boolean(read.data.note) });
    return reply(201, { ok: true, code: "joined", message: t.joined, count: await count() });
  } catch {
    return reply(500, { ok: false, code: "failed", message: t.failed });
  }
}
