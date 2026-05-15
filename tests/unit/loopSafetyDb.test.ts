import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./test.db";

import { prisma } from "@/src/prisma";
import { SERVER_USER_ID } from "@/src/server/auth";
import { checkCostCap, getConversationCost, MAX_CONVERSATION_COST_USD } from "@/src/server/loopSafety";

describe("loopSafety cost caps", () => {
  before(async () => {
    const migrated = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      stdio: "inherit",
      env: { ...process.env },
    });
    assert.equal(migrated.status, 0);
  });

  beforeEach(async () => {
    await prisma.tokenUsage.deleteMany({});
    await prisma.conversation.deleteMany({});
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("sums estimated costs for a conversation", async () => {
    const conv = await prisma.conversation.create({
      data: { userId: SERVER_USER_ID, title: "Cost test" },
    });
    await prisma.tokenUsage.createMany({
      data: [
        { conversationId: conv.id, userId: SERVER_USER_ID, promptTokens: 100, completionTokens: 50, estimatedCostUsd: 0.5 },
        { conversationId: conv.id, userId: SERVER_USER_ID, promptTokens: 200, completionTokens: 100, estimatedCostUsd: 0.75 },
      ],
    });
    const cost = await getConversationCost(conv.id);
    assert.equal(cost, 1.25);
  });

  it("flags when the cost cap is exceeded", async () => {
    const conv = await prisma.conversation.create({
      data: { userId: SERVER_USER_ID, title: "Cap test" },
    });
    await prisma.tokenUsage.create({
      data: { conversationId: conv.id, userId: SERVER_USER_ID, promptTokens: 1, completionTokens: 1, estimatedCostUsd: MAX_CONVERSATION_COST_USD + 0.1 },
    });
    const cap = await checkCostCap(conv.id);
    assert.equal(cap.allowed, false);
    assert.equal(cap.cap, MAX_CONVERSATION_COST_USD);
  });
});
