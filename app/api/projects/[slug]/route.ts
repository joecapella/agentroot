import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("project.GET", async () => {
    const { slug } = await params;
    const project = await prisma.projectWorkspace.findUnique({
      where: { userId_slug: { userId: principal.userId, slug } },
    });
    if (!project) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ project });
  });
}

const PatchBody = z.object({
  displayName: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  goalsJson: z.string().max(5000).optional(),
  pinnedPathsJson: z.string().max(5000).optional(),
  repoRoot: z.string().max(500).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("project.PATCH", async () => {
    const { slug } = await params;
    let body;
    try {
      body = PatchBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "project.parse");
    }

    const existing = await prisma.projectWorkspace.findUnique({
      where: { userId_slug: { userId: principal.userId, slug } },
    });
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const updated = await prisma.projectWorkspace.update({
      where: { userId_slug: { userId: principal.userId, slug } },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.goalsJson !== undefined ? { goalsJson: body.goalsJson } : {}),
        ...(body.pinnedPathsJson !== undefined ? { pinnedPathsJson: body.pinnedPathsJson } : {}),
        ...(body.repoRoot !== undefined ? { repoRoot: body.repoRoot } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    });
    return NextResponse.json({ project: updated });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("project.DELETE", async () => {
    const { slug } = await params;
    const result = await prisma.projectWorkspace.deleteMany({
      where: { userId: principal.userId, slug },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}
