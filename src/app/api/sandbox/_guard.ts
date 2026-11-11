/** Sandbox API guard (F5.06–F5.08, P9): sandbox mode, a signed-in judge or admin, zod-validated bodies, calm errors. */
import { NextResponse } from "next/server";
import type { z } from "zod";
import { sandboxMode } from "@/lib/clock";
import { viewer } from "@/lib/session";
import { DomainError } from "@/server/types";
import { PLAYGROUND_ROLES } from "@/server/playground";

export interface Judge { id: string; role: string; name: string }

export async function guard(): Promise<Judge | NextResponse> {
  if (!sandboxMode()) return NextResponse.json({ error: "SANDBOX_ONLY", message: "The Judge Playground is not available in production." }, { status: 404 });
  const v = await viewer();
  if (!v) return NextResponse.json({ error: "SIGNED_OUT", message: "Sign in as the judge to use the playground." }, { status: 401 });
  if (!PLAYGROUND_ROLES.includes(v.role)) return NextResponse.json({ error: "FORBIDDEN", message: "The playground is for judges and platform admins." }, { status: 403 });
  return { id: v.id, role: v.role, name: v.name };
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T> | NextResponse> {
  let raw: unknown;
  try { raw = await req.json(); } catch { raw = {}; }
  const r = schema.safeParse(raw);
  if (!r.success) return NextResponse.json({ error: "BAD_INPUT", message: r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, { status: 400 });
  return r.data;
}

export function fail(e: unknown): NextResponse {
  if (e instanceof DomainError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.code === "SANDBOX_ONLY" ? 404 : e.code === "SIM_NOT_FOUND" ? 404 : e.code === "SIM_BUSY" ? 409 : 400 });
  console.error("[sandbox]", e);
  return NextResponse.json({ error: "INTERNAL", message: "The playground hit an unexpected error. Nothing real moved; try Reset." }, { status: 500 });
}

/** The app's own origin, for HTTP calls to other modules' endpoints when they are not reachable in-process. */
export const originOf = (req: Request) => { try { return new URL(req.url).origin; } catch { return undefined; } };
