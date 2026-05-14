/**
 * Prompt A/B testing framework.
 *
 * Stores variant prompts per persona and returns the active one.
 */

import { prisma } from "@/src/prisma";

export async function getActivePrompt(persona: string): Promise<string | null> {
  const variant = await prisma.promptVariant.findFirst({
    where: { persona, isActive: true },
    orderBy: [{ winRate: "desc" }, { usageCount: "desc" }],
  });
  return variant?.content ?? null;
}

export async function recordUsage(persona: string, variantKey: string) {
  await prisma.promptVariant.updateMany({
    where: { persona, variantKey },
    data: { usageCount: { increment: 1 } },
  });
}

export async function registerVariant(args: {
  persona: string;
  variantKey: string;
  content: string;
  isActive?: boolean;
}) {
  return prisma.promptVariant.upsert({
    where: { persona_variantKey: { persona: args.persona, variantKey: args.variantKey } },
    update: {
      content: args.content,
      ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
    },
    create: {
      persona: args.persona,
      variantKey: args.variantKey,
      content: args.content,
      isActive: args.isActive ?? false,
    },
  });
}

export async function listVariants(persona?: string) {
  return prisma.promptVariant.findMany({
    where: persona ? { persona } : undefined,
    orderBy: [{ persona: "asc" }, { variantKey: "asc" }],
  });
}
