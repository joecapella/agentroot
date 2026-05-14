import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Local-only compatibility endpoint. No token/session required. */
export async function POST() {
  return NextResponse.json({ authenticated: true, mode: "local" });
}
