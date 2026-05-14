import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/prisma";
import { requireAuth } from "@/src/server/auth";
import { runRoute } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("approvals.GET", async () => {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? "pending";
    const list = await prisma.approval.findMany({
      where: { userId: principal.userId, status },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ approvals: list });
  });
}
