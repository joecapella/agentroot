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

  return runRoute("projects.GET", async () => {
    const list = await prisma.projectWorkspace.findMany({
      where: { userId: principal.userId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 100,
    });
    return NextResponse.json({ projects: list });
  });
}

const CreateBody = z.object({
  slug: z.string().min(1).max(60),
  displayName: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  repoRoot: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("projects.POST", async () => {
    let body;
    try {
      body = CreateBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "projects.parse");
    }

    try {
      const project = await prisma.projectWorkspace.create({
        data: {
          userId: principal.userId,
          slug: body.slug,
          displayName: body.displayName,
          description: body.description ?? null,
          repoRoot: body.repoRoot ?? null,
        },
      });
      return NextResponse.json({ project }, { status: 201 });
    } catch (err: unknown) {
      const msg = String((err as { message?: string }).message ?? "");
      if (msg.includes("Unique constraint")) {
        return NextResponse.json(
          { error: "duplicate_slug" },
          { status: 409 }
        );
      }
      throw err;
    }
  });
}
