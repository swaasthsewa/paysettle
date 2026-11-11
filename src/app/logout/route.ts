import { NextResponse } from "next/server";
import { endSession } from "@/lib/session";
export async function GET(req: Request) { await endSession(); return NextResponse.redirect(new URL("/login", req.url)); }
