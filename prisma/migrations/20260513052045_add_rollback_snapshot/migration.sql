-- CreateTable
CREATE TABLE "RollbackSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "snapshotDir" TEXT NOT NULL,
    "pathsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RollbackSnapshot_userId_createdAt_idx" ON "RollbackSnapshot"("userId", "createdAt");
