/**
 * Memory layer utilities — the single place to read/write memory models.
 *
 * All data access goes through here; route handlers never touch prisma
 * directly for memory entities.  Every function requires an explicit userId
 * so callers (routes) must `requireAuth` first — no ambient / default
 * user context.
 */

import { prisma } from "./prisma";
import { FACT_CATEGORIES, type FactCategory } from "@/app/lib/types";
export { FACT_CATEGORIES, type FactCategory };

export interface FactSnippet {
  label: string;
  fullText: string;
  category: FactCategory;
  importance: number;
}

const MAX_MEMORY_CHARS = 1200;
const MIN_IMPORTANCE_FOR_AUTO = 4;

export const EXTRACTION_GUIDE = `
=== EXTRACTION INSTRUCTIONS ===
When the user shares a preference, constraint, project detail, lesson learned, or identity fact that should be remembered across sessions, include a marker in your response like:
[MEMORY_FACT:preference:8]
Joseph prefers tab indentation and never uses semicolons in TypeScript.
[/MEMORY_FACT]
Use category: preference | constraint | project_knowledge | lesson_learned | identity.
Importance 1–10. Keep labels under 60 characters.
===
`;

// ── UserProfile ────────────────────────────────────────────────────────────

export async function getOrCreateProfile(userId: string) {
  let profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile) {
    profile = await prisma.userProfile.create({
      data: { userId, displayName: "Joseph" },
    });
  }
  return profile;
}

export async function updateProfile(
  userId: string,
  patch: {
    displayName?: string;
    defaultReasoning?: string;
    defaultTools?: string;
    defaultPersona?: string;
    preferencesJson?: string;
  }
) {
  return prisma.userProfile.update({ where: { userId }, data: patch });
}

// ── Facts ──────────────────────────────────────────────────────────────────

export async function fetchFacts(
  userId: string,
  options?: {
    categories?: FactCategory[];
    minImportance?: number;
    limit?: number;
  }
): Promise<FactSnippet[]> {
  const now = new Date();
  const rows = await prisma.fact.findMany({
    where: {
      userId,
      importance: { gte: options?.minImportance ?? MIN_IMPORTANCE_FOR_AUTO },
      ...(options?.categories && options.categories.length > 0
        ? { category: { in: options.categories } }
        : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
    take: options?.limit ?? 50,
  });
  return rows.map((r) => ({
    label: r.label,
    fullText: r.fullText,
    category: r.category as FactCategory,
    importance: r.importance,
  }));
}

export async function getMemoryPreamble(
  userId: string,
  options?: { categories?: FactCategory[] }
): Promise<string> {
  const facts = await fetchFacts(userId, { categories: options?.categories });
  return buildMemoryPreamble(facts);
}

// ── Fact CRUD (repository layer) ──────────────────────────────────────────

export interface FactCreateInput {
  userId: string;
  category: FactCategory;
  label: string;
  fullText: string;
  importance?: number;
  expiresAt?: Date | null;
}

export async function createFact(input: FactCreateInput) {
  return prisma.fact.create({
    data: {
      userId: input.userId,
      category: input.category,
      label: input.label,
      fullText: input.fullText,
      importance: input.importance ?? 5,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export interface FactListOptions {
  userId: string;
  category?: FactCategory;
  q?: string;
  limit?: number;
}

export async function listFacts(options: FactListOptions) {
  const where: Record<string, unknown> = {
    userId: options.userId,
    ...(options.category ? { category: options.category } : {}),
    ...(options.q
      ? {
          OR: [
            { label: { contains: options.q, mode: "insensitive" } },
            { fullText: { contains: options.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.fact.findMany({
      where,
      orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
      take: Math.min(options.limit ?? 50, 200),
    }),
    prisma.fact.count({ where }),
  ]);
  return { items, total };
}

export async function updateFact(
  userId: string,
  id: string,
  patch: {
    label?: string;
    fullText?: string;
    importance?: number;
    expiresAt?: Date | null;
  }
) {
  // Verify ownership before update.
  const existing = await prisma.fact.findFirst({
    where: { id, userId },
  });
  if (!existing) return null;
  return prisma.fact.update({ where: { id }, data: patch });
}

export async function deleteFact(userId: string, id: string) {
  const existing = await prisma.fact.findFirst({
    where: { id, userId },
  });
  if (!existing) return false;
  await prisma.fact.delete({ where: { id } });
  return true;
}

export async function getFactById(userId: string, id: string) {
  return prisma.fact.findFirst({ where: { id, userId } });
}

// ── Preamble building (pure, no DB) ────────────────────────────────────────

export function buildMemoryPreamble(facts: FactSnippet[]): string {
  if (facts.length === 0) return "";
  let total = 0;
  const picked: FactSnippet[] = [];
  for (const f of facts) {
    const entry = `[${f.category}] ${f.fullText}`;
    if (total + entry.length + 1 > MAX_MEMORY_CHARS) break;
    picked.push(f);
    total += entry.length + 1;
  }
  if (picked.length === 0) return "";
  return "\n=== MEMORY ===\n" + picked.map((f) => `[${f.category}] ${f.fullText}`).join("\n") + "\n===\n";
}
