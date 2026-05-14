/**
 * Multi-step plan execution engine.
 *
 * A Plan is a list of steps. Each step may involve a tool call.
 * The engine executes steps sequentially, respecting approval policies.
 */

import { prisma } from "@/src/prisma";

export interface CreatePlanInput {
  userId: string;
  conversationId?: string;
  title: string;
  steps: Array<{
    description: string;
    toolName?: string;
    toolParams?: Record<string, unknown>;
  }>;
}

export async function createPlan(input: CreatePlanInput) {
  const plan = await prisma.plan.create({
    data: {
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      title: input.title,
    },
  });

  for (let i = 0; i < input.steps.length; i++) {
    const s = input.steps[i];
    await prisma.planStep.create({
      data: {
        planId: plan.id,
        stepNumber: i + 1,
        description: s.description,
        toolName: s.toolName ?? null,
        toolParamsJson: s.toolParams ? JSON.stringify(s.toolParams) : null,
      },
    });
  }

  return prisma.plan.findUnique({
    where: { id: plan.id },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });
}

export async function getPlan(userId: string, planId: string) {
  return prisma.plan.findFirst({
    where: { id: planId, userId },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });
}

export async function updateStepResult(
  userId: string,
  stepId: string,
  result: { status: "completed" | "failed"; resultJson?: string; error?: string }
) {
  const step = await prisma.planStep.findFirst({
    where: { id: stepId },
    include: { plan: true },
  });
  if (!step || step.plan.userId !== userId) return null;

  return prisma.planStep.update({
    where: { id: stepId },
    data: {
      status: result.status,
      resultJson: result.resultJson ?? null,
      completedAt: new Date(),
    },
  });
}

export async function listPlans(userId: string, status?: string) {
  return prisma.plan.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });
}
