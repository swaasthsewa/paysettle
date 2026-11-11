/**
 * F3.05 hybrid manual mode: POST /api/oracles/[id]/manual — Operations counter-verifies an external check that could not
 * run (or did not come back green). Form fields or JSON: decision (CONFIRMED | REJECTED), note, back (same-site path).
 * Permission oracle.manual_verify (Ops only); every decision is audited and appended as a signed attestation.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { audit } from "@/lib/audit";
import { canWrite } from "@/lib/rbac";
import { viewer } from "@/lib/session";
import { manualVerify } from "@/server/evidence/oracles";
import { DomainError } from "@/server/types";

export const dynamic = "force-dynamic";
const Body = z.object({
  decision: z.enum(["CONFIRMED", "REJECTED"]),
  note: z.string().trim().min(3, "Say what you checked.").max(300),
  back: z.string().regex(/^\/[A-Za-z0-9/_\-?=&.%]*$/).max(300).optional(),
});
const STATUS: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, BAD_STATE: 409, NOTE_REQUIRED: 400 };

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const v = await viewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return NextResponse.json({ error: "Unknown check." }, { status: 404 });
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  let raw: Record<string, unknown> = {};
  try { raw = isJson ? await req.json() : Object.fromEntries((await req.formData()).entries()); } catch { return NextResponse.json({ error: "The request could not be read." }, { status: 400 }); }
  const p = Body.safeParse(raw);
  const back = (msg: string, ok: boolean) => {
    const to = new URL(p.success && p.data.back ? p.data.back : "/", req.url);
    to.searchParams.set(ok ? "ok" : "err", msg);
    return NextResponse.redirect(to, 303);
  };
  if (!p.success) return isJson ? NextResponse.json({ error: "Some fields are not valid.", issues: p.error.issues.map((i) => i.message) }, { status: 400 }) : back(p.error.issues[0]?.message ?? "Some fields are not valid.", false);
  if (!canWrite(v.role, "oracle.manual_verify")) {
    await audit(db, { id: v.id, role: v.role }, "oracle.manual_denied", id, {});
    return isJson ? NextResponse.json({ error: "Only Operations can counter-verify an external check." }, { status: 403 }) : back("Only Operations can counter-verify an external check.", false);
  }
  try {
    const row = await manualVerify({ id: v.id, role: v.role, name: v.name, requestId: req.headers.get("x-request-id") ?? undefined }, id, { decision: p.data.decision, note: p.data.note });
    return isJson ? NextResponse.json({ ok: true, attestation: { id: row.id, level: row.level, mode: row.mode, signature: row.signature } }) : back(`External check ${p.data.decision === "CONFIRMED" ? "confirmed" : "marked not confirmed"} by Operations.`, true);
  } catch (e) {
    if (e instanceof DomainError) return isJson ? NextResponse.json({ error: e.message, code: e.code }, { status: STATUS[e.code] ?? 400 }) : back(e.message, false);
    console.error("oracle manual verify failed", e);
    return isJson ? NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 }) : back("Something went wrong. Try again.", false);
  }
}
