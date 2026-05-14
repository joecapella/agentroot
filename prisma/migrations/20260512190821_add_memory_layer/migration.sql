-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT 'Joseph',
    "email" TEXT,
    "defaultReasoning" TEXT NOT NULL DEFAULT 'balanced',
    "defaultTools" TEXT NOT NULL DEFAULT 'ask',
    "defaultPersona" TEXT NOT NULL DEFAULT 'auto',
    "preferencesJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'preference',
    "label" TEXT NOT NULL,
    "fullText" TEXT NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 5,
    "source" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProjectWorkspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "goalsJson" TEXT NOT NULL DEFAULT '[]',
    "pinnedPathsJson" TEXT NOT NULL DEFAULT '[]',
    "repoRoot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ToolPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "policy" TEXT NOT NULL DEFAULT 'ask',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paramsJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "paramsJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "toolExecutionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME
);

-- CreateTable
CREATE TABLE "RetrievalIndex" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "keywords" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "UserProfile_userId_idx" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "Fact_userId_category_idx" ON "Fact"("userId", "category");

-- CreateIndex
CREATE INDEX "Fact_userId_importance_idx" ON "Fact"("userId", "importance");

-- CreateIndex
CREATE INDEX "ProjectWorkspace_userId_status_idx" ON "ProjectWorkspace"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWorkspace_userId_slug_key" ON "ProjectWorkspace"("userId", "slug");

-- CreateIndex
CREATE INDEX "ToolPolicy_userId_idx" ON "ToolPolicy"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolPolicy_userId_toolName_key" ON "ToolPolicy"("userId", "toolName");

-- CreateIndex
CREATE INDEX "ToolExecution_userId_toolName_idx" ON "ToolExecution"("userId", "toolName");

-- CreateIndex
CREATE INDEX "ToolExecution_userId_status_idx" ON "ToolExecution"("userId", "status");

-- CreateIndex
CREATE INDEX "ToolExecution_createdAt_idx" ON "ToolExecution"("createdAt");

-- CreateIndex
CREATE INDEX "Approval_userId_status_idx" ON "Approval"("userId", "status");

-- CreateIndex
CREATE INDEX "Approval_createdAt_idx" ON "Approval"("createdAt");

-- CreateIndex
CREATE INDEX "RetrievalIndex_userId_source_idx" ON "RetrievalIndex"("userId", "source");

-- CreateIndex
CREATE INDEX "RetrievalIndex_userId_path_idx" ON "RetrievalIndex"("userId", "path");
