import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/src/server/auth";
import { runRoute } from "@/src/server/errors";
import { getDashboardMetrics, logEvent } from "@/src/server/analytics";
import { getUsageSummary } from "@/src/server/tokenTracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("analytics.GET", async () => {
    const { searchParams } = new URL(req.url);
    const days = Math.min(parseInt(searchParams.get("days") ?? "7", 10), 90);

    const [metrics, usage] = await Promise.all([
      getDashboardMetrics(principal.userId, days),
      getUsageSummary(principal.userId, days),
    ]);

    return NextResponse.json({ metrics, usage });
  });
}
