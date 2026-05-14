-- CreateTable
CREATE TABLE "UserSecret" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'default',
    "encryptedValue" TEXT NOT NULL,
    "redactedPreview" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "lastVerifiedAt" DATETIME,
    "rotatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "monthlySpendLimitUsd" REAL NOT NULL DEFAULT 0,
    "dailySpendLimitUsd" REAL NOT NULL DEFAULT 0,
    "maxToolCallsPerDay" INTEGER NOT NULL DEFAULT 0,
    "maxAgentLoopsPerTurn" INTEGER NOT NULL DEFAULT 25,
    "maxImagesPerDay" INTEGER NOT NULL DEFAULT 0,
    "memoryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "factExtractionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "storeToolOutputs" BOOLEAN NOT NULL DEFAULT true,
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 0,
    "autonomyLevel" TEXT NOT NULL DEFAULT 'balanced',
    "extraJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "UserSecret_userId_idx" ON "UserSecret"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSecret_userId_provider_label_key" ON "UserSecret"("userId", "provider", "label");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "UserSettings_userId_idx" ON "UserSettings"("userId");
