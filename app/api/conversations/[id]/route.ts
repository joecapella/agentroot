import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("conversation.GET", async () => {
    const { id } = await params;
    const conv = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        tasks: { orderBy: { createdAt: "desc" }, take: 100 },
      },
    });
    if (!conv || conv.userId !== principal.userId) {
      // 404 — do not distinguish "not yours" from "doesn't exist".
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ conversation: conv });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("conversation.DELETE", async () => {
    const { id } = await params;
    // deleteMany with composite filter is atomic: only deletes if the
    // ownership predicate matches. Avoids a TOCTOU between findUnique +
    // delete.
    const result = await prisma.conversation.deleteMany({
      where: { id, userId: principal.userId },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}
