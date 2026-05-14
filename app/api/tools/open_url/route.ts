/**
 * POST /api/tools/open_url
 *
 * Stage 1 of the open-url workflow: validate the URL, create a Task row in
 * AWAITING_APPROVAL state, return its id. This route NEVER opens the
 * browser; it only records intent. Stage 2 lives at
 * `/api/tools/open_url/approve/[taskId]` and is the only path that calls
 * `xdg-open`.
 *
 * Why split? Two reasons, both raised by the Control Agent reviews:
 *
 * 1. Removing `execute: true` from the public schema eliminates the path
 *    where an authenticated caller can request a host-side side effect in
 *    one round-trip. Even with auth, the principle of explicit user consent
 *    matters because the agent itself drives many of these requests.
 *
 * 2. The agent's orchestrator prompt now correctly says: *propose* a URL
 *    open; the user (or UI on the user's behalf) clicks Approve. This keeps
 *    the agent → human-in-the-loop semantics honest.
 *
 * Auth: bearer token + same-origin marker header.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  url: z.string().url(),
  reason: z.string().max(240).optional(),
  conversationId: z.string().optional(),
});

function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("tools.open_url.POST", async () => {
    let body;
    try {
      body = Body.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "open_url.parse");
    }
    if (!isSafeUrl(body.url)) {
      return NextResponse.json({ error: "unsafe_url" }, { status: 400 });
    }

    // If a conversationId is supplied, verify ownership before attributing
    // the task to it.
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
        type: "open_url",
        status: "AWAITING_APPROVAL",
        paramsJson: JSON.stringify({ url: body.url, reason: body.reason ?? null }),
        summary: body.reason ? `open_url — ${body.reason}` : `open_url`,
      },
    });

    return NextResponse.json({
      ok: true,
      taskId: task.id,
      status: "AWAITING_APPROVAL",
    });
  });
}
