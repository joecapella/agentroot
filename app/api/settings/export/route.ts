/**
 * POST /api/settings/export — export all user data as a JSON blob.
 *
 * Returns conversations, messages, facts, tool policies, tool executions,
 * approvals, projects, and profile. Ownership-scoped to the requesting user.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/prisma";
import { requireAuth } from "@/src/server/auth";
import { runRoute } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("settings.export.POST", async () => {
    const [
      profile,
      conversations,
      messages,
      facts,
      toolPolicies,
      toolExecutions,
      approvals,
      projects,
      plans,
      planSteps,
    ] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId: principal.userId } }),
      prisma.conversation.findMany({ where: { userId: principal.userId } }),
      prisma.message.findMany({
        where: { conversation: { userId: principal.userId } },
      }),
      prisma.fact.findMany({ where: { userId: principal.userId } }),
      prisma.toolPolicy.findMany({ where: { userId: principal.userId } }),
      prisma.toolExecution.findMany({ where: { userId: principal.userId } }),
      prisma.approval.findMany({ where: { userId: principal.userId } }),
      prisma.projectWorkspace.findMany({ where: { userId: principal.userId } }),
      prisma.plan.findMany({ where: { userId: principal.userId } }),
      prisma.planStep.findMany({
        where: { plan: { userId: principal.userId } },
      }),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      version: "1",
      profile,
      conversations,
      messages,
      facts,
      toolPolicies,
      toolExecutions,
      approvals,
      projects,
      plans,
      planSteps,
    };

    return NextResponse.json({ data: exportData });
  });
}
