import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Local-only compatibility endpoint. Always authenticated. */
export async function GET() {
  return NextResponse.json({ authenticated: true, mode: "local" });
}
