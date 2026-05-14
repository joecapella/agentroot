/**
 * GET|PATCH|DELETE /api/facts/:id
 *
 * All data access goes through src/memory.ts (repository pattern).
 * Route handlers never touch Prisma directly for memory entities.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { deleteFact, getFactById, updateFact } from "@/src/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  fullText: z.string().min(1).max(2000).optional(),
  importance: z.number().int().min(1).max(10).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("facts.id.GET", async () => {
    const { id } = await props.params;
    const fact = await getFactById(principal.userId, id);
    if (!fact) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ fact });
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("facts.id.PATCH", async () => {
    const { id } = await props.params;

    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return sanitizedError("bad_request", 400, parsed.error.format(), "facts.id.parse");
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.label !== undefined) data.label = parsed.data.label;
    if (parsed.data.fullText !== undefined) data.fullText = parsed.data.fullText;
    if (parsed.data.importance !== undefined) data.importance = parsed.data.importance;
    if (parsed.data.expiresAt !== undefined) {
      data.expiresAt = parsed.data.expiresAt === null ? null : new Date(parsed.data.expiresAt);
    }

    const updated = await updateFact(principal.userId, id, data);
    if (!updated) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ fact: updated });
  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("facts.id.DELETE", async () => {
    const { id } = await props.params;
    const ok = await deleteFact(principal.userId, id);
    if (!ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}
