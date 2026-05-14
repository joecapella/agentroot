/**
 * POST /api/tools/create_todo
 *
 * Records a todo as a Task row. Auth-gated. Ownership-checked when a
 * conversationId is supplied.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  due: z.string().datetime().optional(),
  conversationId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("tools.create_todo.POST", async () => {
    let body;
    try {
      body = Body.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "create_todo.parse");
    }
    if (body.conversationId) {
      const conv = await prisma.conversation.findUnique({
        where: { id: body.conversationId },
        select: { userId: true },
      });
      if (!conv || conv.userId !== principal.userId) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
    }
    const task = await prisma.task.create({
      data: {
        userId: principal.userId,
        conversationId: body.conversationId ?? null,
        type: "create_todo",
        status: "COMPLETED",
        paramsJson: JSON.stringify({
          title: body.title,
          notes: body.notes,
          due: body.due,
        }),
        summary: body.title,
      },
    });
    return NextResponse.json({ ok: true, taskId: task.id });
  });
}
