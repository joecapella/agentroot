-- Rename foundrySession to previousResponseId for clarity
ALTER TABLE "Conversation" RENAME COLUMN "foundrySession" TO "previousResponseId";
