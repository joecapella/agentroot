import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/src/server/auth";
import { runRoute } from "@/src/server/errors";
import { getPlan } from "@/src/server/planning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("plans.id.GET", async () => {
    const { id } = await params;
    const plan = await getPlan(principal.userId, id);
    if (!plan) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ plan });
  });
}
