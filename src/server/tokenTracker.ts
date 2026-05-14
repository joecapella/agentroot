/**
 * Token usage and cost tracking.
 *
 * Heuristic cost estimates based on published Azure OpenAI pricing.
 * No billing integration — just observability.
 */

import { prisma } from "@/src/prisma";

// USD per 1K tokens (rough Azure list prices as of 2026-05)
const COST_PER_1K: Record<string, { prompt: number; completion: number }> = {
  "gpt-5.5": { prompt: 0.0015, completion: 0.002 },
  "gpt-4.1": { prompt: 0.005, completion: 0.015 },
  "claude-opus-4-7": { prompt: 0.015, completion: 0.075 },
  "claude-sonnet-4-6": { prompt: 0.003, completion: 0.015 },
  "deepseek-v4-flash": { prompt: 0.0005, completion: 0.0005 },
  "kimi-k2.6": { prompt: 0.002, completion: 0.006 },
};

export function estimateCost(args: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number {
  const rates = COST_PER_1K[args.model] ?? { prompt: 0.002, completion: 0.002 };
  const promptCost = (args.promptTokens / 1000) * rates.prompt;
  const completionCost = (args.completionTokens / 1000) * rates.completion;
  return Math.round((promptCost + completionCost) * 1_000_000) / 1_000_000;
}

export async function recordTokenUsage(args: {
  userId: string;
  conversationId?: string;
  messageId?: string;
  modelUsed: string;
  promptTokens?: number;
  completionTokens?: number;
}) {
  const promptTokens = args.promptTokens ?? 0;
  const completionTokens = args.completionTokens ?? 0;
  const totalTokens = promptTokens + completionTokens;
  const estimatedCostUsd = estimateCost({
    model: args.modelUsed,
    promptTokens,
    completionTokens,
  });

  return prisma.tokenUsage.create({
    data: {
      userId: args.userId,
      conversationId: args.conversationId ?? null,
      messageId: args.messageId ?? null,
      modelUsed: args.modelUsed,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
    },
  });
}

export async function getUsageSummary(userId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.tokenUsage.findMany({
    where: { userId, createdAt: { gte: since } },
  });

  const byModel: Record<string, { prompt: number; completion: number; cost: number }> = {};
  let totalCost = 0;

  for (const r of rows) {
    const m = r.modelUsed ?? "unknown";
    if (!byModel[m]) byModel[m] = { prompt: 0, completion: 0, cost: 0 };
    byModel[m].prompt += r.promptTokens ?? 0;
    byModel[m].completion += r.completionTokens ?? 0;
    byModel[m].cost += r.estimatedCostUsd ?? 0;
    totalCost += r.estimatedCostUsd ?? 0;
  }

  return {
    days,
    totalCalls: rows.length,
    totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
    byModel,
  };
}
