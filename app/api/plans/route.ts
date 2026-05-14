import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { createPlan, listPlans } from "@/src/server/planning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostBody = z.object({
  title: z.string().min(1).max(200),
  conversationId: z.string().optional(),
  steps: z.array(
    z.object({
      description: z.string().min(1),
      toolName: z.string().optional(),
      toolParams: z.record(z.unknown()).optional(),
    })
  ),
});

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("plans.POST", async () => {
    let body;
    try {
      body = PostBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "plans.parse");
    }

    const plan = await createPlan({
      userId: principal.userId,
      conversationId: body.conversationId,
      title: body.title,
      steps: body.steps,
    });

    return NextResponse.json({ plan });
  });
}

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("plans.GET", async () => {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? undefined;
    const plans = await listPlans(principal.userId, status);
    return NextResponse.json({ plans });
  });
}
