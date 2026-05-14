import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { updateStepResult } from "@/src/server/planning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchBody = z.object({
  status: z.enum(["completed", "failed"]),
  resultJson: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("plans.steps.PATCH", async () => {
    const { stepId } = await params;
    let body;
    try {
      body = PatchBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "plans.steps.parse");
    }

    const step = await updateStepResult(principal.userId, stepId, {
      status: body.status,
      resultJson: body.resultJson,
    });

    if (!step) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ step });
  });
}
