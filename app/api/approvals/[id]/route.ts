import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ResolveBody = z.object({
  decision: z.enum(["approved", "rejected"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("approvals.POST", async () => {
    const { id } = await params;
    let body;
    try {
      body = ResolveBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "approvals.parse");
    }

    const approval = await prisma.approval.findFirst({
      where: { id, userId: principal.userId },
    });
    if (!approval) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (approval.status !== "pending") {
      return NextResponse.json(
        { error: "already_resolved", status: approval.status },
        { status: 409 }
      );
    }

    const updated = await prisma.approval.update({
      where: { id },
      data: {
        status: body.decision,
        resolvedAt: new Date(),
      },
    });

    if (approval.toolExecutionId) {
      await prisma.toolExecution.update({
        where: { id: approval.toolExecutionId },
        data: {
          status: body.decision === "approved" ? "approved" : "blocked",
          completedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ approval: updated });
  });
}
