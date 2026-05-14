/**
 * Loop safety guards: cost caps and history truncation.
 */

import { prisma } from "@/src/prisma";

export const MAX_CONVERSATION_COST_USD = 2.0;
export const MAX_HISTORY_MESSAGES = 20;

export async function getConversationCost(conversationId: string): Promise<number> {
  const usages = await prisma.tokenUsage.findMany({
    where: { conversationId },
  });
  return usages.reduce((sum, u) => sum + (u.estimatedCostUsd ?? 0), 0);
}

export async function checkCostCap(
  conversationId: string
): Promise<{ allowed: boolean; currentCost: number; cap: number }> {
  const currentCost = await getConversationCost(conversationId);
  return {
    allowed: currentCost < MAX_CONVERSATION_COST_USD,
    currentCost,
    cap: MAX_CONVERSATION_COST_USD,
  };
}

export function truncateHistory<T extends { role: string; content: string }>(
  messages: T[],
  maxMessages = MAX_HISTORY_MESSAGES
): T[] {
  if (messages.length <= maxMessages) return messages;

  // Always keep the first user message (intent) and the last N messages
  const firstUserIndex = messages.findIndex((m) => m.role === "user");
  const keepFirst = firstUserIndex >= 0 ? [messages[firstUserIndex]] : [];

  const remaining = messages.filter((_, i) => i !== firstUserIndex);
  const tailCount = maxMessages - keepFirst.length;
  const tail = remaining.slice(-tailCount);

  return [...keepFirst, ...tail];
}
