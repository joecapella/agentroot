-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" DATETIME,
    "endAt" DATETIME,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "icsContent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_CalendarEvent" ("createdAt", "description", "endAt", "icsContent", "id", "startAt", "status", "timezone", "title", "userId") SELECT "createdAt", "description", "endAt", "icsContent", "id", "startAt", "status", coalesce("timezone", 'America/Chicago') AS "timezone", "title", "userId" FROM "CalendarEvent";
DROP TABLE "CalendarEvent";
ALTER TABLE "new_CalendarEvent" RENAME TO "CalendarEvent";
CREATE INDEX "CalendarEvent_userId_startAt_idx" ON "CalendarEvent"("userId", "startAt");
CREATE TABLE "new_CiCdJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "repo" TEXT NOT NULL,
    "workflow" TEXT,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "runUrl" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);
INSERT INTO "new_CiCdJob" ("branch", "completedAt", "createdAt", "error", "id", "provider", "repo", "runUrl", "status", "userId", "workflow") SELECT coalesce("branch", 'main') AS "branch", "completedAt", "createdAt", "error", "id", "provider", "repo", "runUrl", "status", "userId", "workflow" FROM "CiCdJob";
DROP TABLE "CiCdJob";
ALTER TABLE "new_CiCdJob" RENAME TO "CiCdJob";
CREATE INDEX "CiCdJob_userId_createdAt_idx" ON "CiCdJob"("userId", "createdAt");
CREATE TABLE "new_Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Plan_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Plan" ("conversationId", "createdAt", "id", "status", "title", "updatedAt", "userId") SELECT "conversationId", "createdAt", "id", "status", "title", "updatedAt", "userId" FROM "Plan";
DROP TABLE "Plan";
ALTER TABLE "new_Plan" RENAME TO "Plan";
CREATE INDEX "Plan_userId_status_idx" ON "Plan"("userId", "status");
CREATE TABLE "new_PlanStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "toolName" TEXT,
    "toolParamsJson" TEXT,
    "resultJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "PlanStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlanStep" ("completedAt", "createdAt", "description", "id", "planId", "resultJson", "status", "stepNumber", "toolName", "toolParamsJson") SELECT "completedAt", "createdAt", "description", "id", "planId", "resultJson", "status", "stepNumber", "toolName", "toolParamsJson" FROM "PlanStep";
DROP TABLE "PlanStep";
ALTER TABLE "new_PlanStep" RENAME TO "PlanStep";
CREATE INDEX "PlanStep_planId_idx" ON "PlanStep"("planId");
CREATE TABLE "new_TokenUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "modelUsed" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCostUsd" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TokenUsage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TokenUsage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TokenUsage" ("completionTokens", "conversationId", "createdAt", "estimatedCostUsd", "id", "messageId", "modelUsed", "promptTokens", "totalTokens", "userId") SELECT "completionTokens", "conversationId", "createdAt", "estimatedCostUsd", "id", "messageId", "modelUsed", "promptTokens", "totalTokens", "userId" FROM "TokenUsage";
DROP TABLE "TokenUsage";
ALTER TABLE "new_TokenUsage" RENAME TO "TokenUsage";
CREATE INDEX "TokenUsage_userId_createdAt_idx" ON "TokenUsage"("userId", "createdAt");
CREATE INDEX "TokenUsage_conversationId_idx" ON "TokenUsage"("conversationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineIndex
DROP INDEX "AnalyticsEvent_userId_eventType_idx";
CREATE INDEX "AnalyticsEvent_userId_eventType_createdAt_idx" ON "AnalyticsEvent"("userId", "eventType", "createdAt");

-- RedefineIndex
DROP INDEX "PromptVariant_persona_variantKey_idx";
CREATE UNIQUE INDEX "PromptVariant_persona_variantKey_key" ON "PromptVariant"("persona", "variantKey");
