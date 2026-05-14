import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/prisma";
import { requireAuth } from "@/src/server/auth";
import { runRoute } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/tasks — list tasks for the authenticated user.
 *
 * Conversation-attached tasks are scoped via their owning Conversation.
 * Conversation-less tool tasks are scoped by Task.userId.
 */
export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("tasks.GET", async () => {
    const conversationId = req.nextUrl.searchParams.get("conversationId") ?? undefined;

    if (conversationId) {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, userId: true },
      });
      if (!conv || conv.userId !== principal.userId) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const tasks = await prisma.task.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return NextResponse.json({ tasks });
    }

    // No conversationId — include both conversation-owned tasks and
    // conversation-less tasks created for this local user.
    const tasks = await prisma.task.findMany({
      where: {
        OR: [
          { conversation: { is: { userId: principal.userId } } },
          { conversationId: null, userId: principal.userId },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ tasks });
  });
}
