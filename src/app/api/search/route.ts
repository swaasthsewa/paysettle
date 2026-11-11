import { NextResponse } from "next/server";
import { viewer } from "@/lib/session";
import { menuPages } from "@/lib/menu";
export const dynamic = "force-dynamic";
export async function GET() {
  const v = await viewer();
  if (!v) return NextResponse.json({ items: [] }, { status: 401 });
  return NextResponse.json({ items: menuPages(v.role).map((p) => ({ kind: "page", label: p.label, href: p.href })) });
}
