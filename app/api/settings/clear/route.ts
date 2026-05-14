/**
 * POST /api/settings/clear — delete user data with typed confirmation.
 *
 * Requires the user to type a confirmation string to prevent accidents.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLEAR_TYPES = ["conversations", "facts", "executions", "approvals", "projects", "all"] as const;

const Body = z.object({
  type: z.enum(CLEAR_TYPES),
  confirmation: z.string(),
});

const CONFIRMATION_TEXT: Record<(typeof CLEAR_TYPES)[number], string> = {
  conversations: "DELETE CONVERSATIONS",
  facts: "DELETE FACTS",
  executions: "DELETE EXECUTIONS",
  approvals: "DELETE APPROVALS",
  projects: "DELETE PROJECTS",
  all: "DELETE EVERYTHING",
};

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("settings.clear.POST", async () => {
    let body;
    try {
      body = Body.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "settings.clear.parse");
    }

    const expected = CONFIRMATION_TEXT[body.type];
    if (body.confirmation.trim() !== expected) {
      return sanitizedError("bad_request", 400, `Confirmation must be: ${expected}`, "settings.clear.confirm");
    }

    const where = { userId: principal.userId };
    let deleted = 0;

    switch (body.type) {
      case "conversations": {
        // Messages cascade on conversation delete
        const result = await prisma.conversation.deleteMany({ where });
        deleted = result.count;
        break;
      }
      case "facts": {
        const result = await prisma.fact.deleteMany({ where });
        deleted = result.count;
        break;
      }
      case "executions": {
        const result = await prisma.toolExecution.deleteMany({ where });
        deleted = result.count;
        break;
      }
      case "approvals": {
        const result = await prisma.approval.deleteMany({ where });
        deleted = result.count;
        break;
      }
      case "projects": {
        const result = await prisma.projectWorkspace.deleteMany({ where });
        deleted = result.count;
        break;
      }
      case "all": {
        await prisma.$transaction([
          prisma.message.deleteMany({ where: { conversation: where } }),
          prisma.conversation.deleteMany({ where }),
          prisma.fact.deleteMany({ where }),
          prisma.toolExecution.deleteMany({ where }),
          prisma.approval.deleteMany({ where }),
          prisma.projectWorkspace.deleteMany({ where }),
          prisma.planStep.deleteMany({ where: { plan: { userId: principal.userId } } }),
          prisma.plan.deleteMany({ where }),
          prisma.tokenUsage.deleteMany({ where }),
          prisma.analyticsEvent.deleteMany({ where }),
          prisma.rollbackSnapshot.deleteMany({ where }),
          prisma.retrievalIndex.deleteMany({ where }),
          prisma.voiceJob.deleteMany({ where }),
          prisma.calendarEvent.deleteMany({ where }),
          prisma.ciCdJob.deleteMany({ where }),
          prisma.promptVariant.deleteMany({}),
          // Keep the profile row but reset preferences
          prisma.userProfile.update({
            where: { userId: principal.userId },
            data: { preferencesJson: "{}" },
          }),
        ]);
        deleted = -1; // sentinel for "everything"
        break;
      }
    }

    return NextResponse.json({ cleared: body.type, deleted });
  });
}
