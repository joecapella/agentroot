-- AlterTable
ALTER TABLE "Task" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'joseph';

-- CreateIndex
CREATE INDEX "Task_userId_createdAt_idx" ON "Task"("userId", "createdAt");
