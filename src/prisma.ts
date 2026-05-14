/** Single shared Prisma client. Avoid multiple connections in dev hot reload. */
import { PrismaClient } from "@prisma/client";

declare global {
  var __cofounderPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__cofounderPrisma ??
  // Never enable Prisma query logging here: query parameters can include
  // sensitive chat text, prompt content, tool params/results, and secrets.
  // Keep logs limited to metadata-only warnings/errors.
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__cofounderPrisma = prisma;
}
