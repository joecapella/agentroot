import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("conversations.GET", async () => {
    const project = req.nextUrl.searchParams.get("project") ?? undefined;
    const list = await prisma.conversation.findMany({
      where: {
        userId: principal.userId,
        ...(project ? { project } : {}),
      },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        project: true,
        lastMessageAt: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ conversations: list });
  });
}

const CreateBody = z.object({
  title: z.string().max(120).optional(),
  project: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("conversations.POST", async () => {
    let body;
    try {
      body = CreateBody.parse(await req.json().catch(() => ({})));
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "conversations.parse");
    }
    const conv = await prisma.conversation.create({
      data: {
        userId: principal.userId,
        title: body.title ?? "New conversation",
        project: body.project ?? null,
      },
    });
    return NextResponse.json({ conversation: conv });
  });
}
