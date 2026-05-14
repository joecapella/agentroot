/**
 * GET|POST /api/facts — create, list, and search persistent facts.
 *
 * All data access goes through src/memory.ts (repository pattern).
 * Route handlers never touch Prisma directly for memory entities.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { createFact, listFacts } from "@/src/memory";
import { FACT_CATEGORIES, type FactCategory } from "@/app/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  category: z.enum(FACT_CATEGORIES),
  label: z.string().min(1).max(120),
  fullText: z.string().min(1).max(2000),
  importance: z.number().int().min(1).max(10).optional().default(5),
  expiresAt: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("facts.GET", async () => {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const q = searchParams.get("q") ?? "";
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

    const result = await listFacts({
      userId: principal.userId,
      ...(category && FACT_CATEGORIES.includes(category as FactCategory)
        ? { category: category as FactCategory }
        : {}),
      ...(q ? { q } : {}),
      limit,
    });

    return NextResponse.json(result);
  });
}

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("facts.POST", async () => {
    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return sanitizedError("bad_request", 400, parsed.error.format(), "facts.parse");
    }
    const data = parsed.data;
    const fact = await createFact({
      userId: principal.userId,
      category: data.category,
      label: data.label,
      fullText: data.fullText,
      importance: data.importance,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    });
    return NextResponse.json({ fact }, { status: 201 });
  });
}
