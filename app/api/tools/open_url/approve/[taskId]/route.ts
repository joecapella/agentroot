/**
 * POST /api/tools/open_url/approve/[taskId]
 *
 * Stage 2 of the open-url workflow: the authenticated user (or our trusted
 * UI acting on their behalf) approves a pending open_url Task. This is the
 * ONLY route that actually invokes `xdg-open` on the host.
 *
 * Auth: bearer token + same-origin marker. Ownership: the task must either
 * belong to a conversation owned by the caller or be a conversation-less task
 * whose Task.userId matches the caller.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { openExternalUrl } from "@/src/server/openExternalUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("tools.open_url.approve.POST", async () => {
    const { taskId } = await params;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { conversation: { select: { userId: true } } },
    });
    if (!task) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const owned = task.conversation
      ? task.conversation.userId === principal.userId
      : task.userId === principal.userId;
    if (!owned) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (task.type !== "open_url") {
      return NextResponse.json({ error: "wrong_task_type" }, { status: 400 });
    }
    if (task.status !== "AWAITING_APPROVAL") {
      // Idempotent: if already completed/failed, just return current state.
      return NextResponse.json({ ok: true, status: task.status });
    }

    let url: string;
    try {
      const parsed = JSON.parse(task.paramsJson);
      url = String(parsed.url);
    } catch (err) {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "FAILED", resultJson: JSON.stringify({ error: "bad_params" }) },
      });
      return sanitizedError("bad_params", 400, err, "open_url.approve.params");
    }
    if (!isSafeUrl(url)) {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "FAILED", resultJson: JSON.stringify({ error: "unsafe_url" }) },
      });
      return NextResponse.json({ error: "unsafe_url" }, { status: 400 });
    }

    try {
      await openExternalUrl(url);
    } catch (err) {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "FAILED", resultJson: JSON.stringify({ error: String(err) }) },
      });
      return sanitizedError("open_failed", 500, err, "open_url.approve.spawn");
    }

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "COMPLETED",
        resultJson: JSON.stringify({ approvedAt: new Date().toISOString() }),
      },
    });
    return NextResponse.json({ ok: true, status: updated.status });
  });
}
