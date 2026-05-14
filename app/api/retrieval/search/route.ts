import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/prisma";
import { requireAuth } from "@/src/server/auth";
import { runRoute } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("retrieval.search.GET", async () => {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();
    const source = searchParams.get("source") ?? undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);

    if (!q) {
      return NextResponse.json({ results: [] });
    }

    const terms = q.split(/\s+/).filter((t) => t.length > 1);
    const where: Record<string, unknown> = {
      userId: principal.userId,
      ...(source ? { source } : {}),
    };

    if (terms.length > 0) {
      where.OR = terms.flatMap((term) => [
        { content: { contains: term } },
        { keywords: { contains: term } },
        { path: { contains: term } },
      ]);
    }

    const rows = await prisma.retrievalIndex.findMany({
      where,
      take: limit,
      orderBy: { createdAt: "desc" },
    });

    const scored = rows.map((r) => {
      const hay = `${r.path} ${r.content} ${r.keywords ?? ""}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        const count = hay.split(t).length - 1;
        score += count;
      }
      return { ...r, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return NextResponse.json({
      results: scored.map((r) => ({
        source: r.source,
        path: r.path,
        chunkId: r.chunkId,
        content: r.content.slice(0, 500),
        score: r.score,
      })),
    });
  });
}
