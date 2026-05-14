/**
 * Analytics / metrics layer.
 *
 * Fire-and-forget event logging for dashboard consumption.
 */

import { prisma } from "@/src/prisma";

export async function logEvent(
  userId: string,
  eventType: string,
  payload: Record<string, unknown> = {}
) {
  try {
    await prisma.analyticsEvent.create({
      data: {
        userId,
        eventType,
        payloadJson: JSON.stringify(payload),
      },
    });
  } catch (err) {
    // Analytics should never break the main flow.
    console.error("[analytics] failed to log event:", err);
  }
}

export async function getDashboardMetrics(userId: string, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [totalMessages, totalConversations, toolExecutions, events] = await Promise.all([
    prisma.message.count({
      where: {
        conversation: { userId },
        sender: { in: ["user", "assistant"] },
        createdAt: { gte: since },
      },
    }),
    prisma.conversation.count({
      where: { userId, createdAt: { gte: since } },
    }),
    prisma.toolExecution.groupBy({
      by: ["toolName"],
      where: { userId, createdAt: { gte: since } },
      _count: { toolName: true },
    }),
    prisma.analyticsEvent.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return {
    days,
    totalMessages,
    totalConversations,
    toolUsage: toolExecutions.map((t) => ({
      toolName: t.toolName,
      count: t._count.toolName,
    })),
    recentEvents: events.map((e) => ({
      eventType: e.eventType,
      payload: JSON.parse(e.payloadJson),
      createdAt: e.createdAt,
    })),
  };
}
