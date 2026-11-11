/**
 * F3.04 upload API: POST multipart form data → submitEvidence.
 * Fields: files (repeatable), note, confirm (repeatable: LINK | SIGNATURE | ORACLE), gpsWaiver ("on").
 * P11: bytes are sniffed and checked server-side; nothing uploaded is executed or rendered.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { viewer } from "@/lib/session";
import { DomainError } from "@/server/types";
import { submitEvidence, SpecFailed } from "@/server/evidence";
import { buildNote, CONFIRM_KINDS, MAX_FILE_BYTES, MAX_FILES, MAX_NOTE, type ConfirmKind } from "@/server/evidence/spec";

export const dynamic = "force-dynamic";
const Fields = z.object({
  note: z.string().max(MAX_NOTE).default(""),
  confirm: z.array(z.enum(CONFIRM_KINDS as [ConfirmKind, ...ConfirmKind[]])).max(3).default([]),
  gpsWaiver: z.boolean().default(false),
});
const STATUS: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, BAD_STATE: 409, TOO_MANY_ATTEMPTS: 409, NOT_LOCKED: 409, FILE_TOO_LARGE: 413 };

export async function POST(req: NextRequest, ctx: { params: Promise<{ milestoneId: string }> }) {
  const v = await viewer();
  if (!v) return NextResponse.json({ error: "Sign in to upload evidence." }, { status: 401 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "Cross-site upload refused." }, { status: 403 });
  const { milestoneId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(milestoneId)) return NextResponse.json({ error: "Unknown milestone." }, { status: 404 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "The upload could not be read. Try again." }, { status: 400 }); }
  const parsed = Fields.safeParse({
    note: String(form.get("note") ?? ""),
    confirm: form.getAll("confirm").map(String),
    gpsWaiver: form.get("gpsWaiver") === "on",
  });
  if (!parsed.success) return NextResponse.json({ error: "Some fields are not valid.", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  const blobs = form.getAll("files").filter((x): x is File => typeof x === "object" && x !== null && "arrayBuffer" in x && (x as File).size > 0);
  if (blobs.length > MAX_FILES) return NextResponse.json({ error: `Up to ${MAX_FILES} files per submission.` }, { status: 400 });
  const big = blobs.find((b) => b.size > MAX_FILE_BYTES);
  if (big) return NextResponse.json({ error: `${big.name} is larger than 15 MB.` }, { status: 413 });

  const files = await Promise.all(blobs.map(async (b) => ({ name: b.name, type: b.type, bytes: Buffer.from(await b.arrayBuffer()) })));
  const note = buildNote(parsed.data.note, parsed.data.confirm, parsed.data.gpsWaiver);
  try {
    const r = await submitEvidence({ id: v.id, role: v.role, name: v.name, requestId: req.headers.get("x-request-id") ?? undefined }, milestoneId, files, note);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof SpecFailed) return NextResponse.json({ error: e.message, code: e.code, signals: e.signals }, { status: 422 });
    if (e instanceof DomainError) return NextResponse.json({ error: e.message, code: e.code }, { status: STATUS[e.code] ?? 400 });
    console.error("evidence upload failed", e);
    return NextResponse.json({ error: "The upload did not go through. Nothing was submitted; try again." }, { status: 500 });
  }
}
