/**
 * GET|PATCH /api/profile — user identity and defaults.
 *
 * All data access goes through src/memory.ts (repository pattern).
 * Route handlers never touch Prisma directly for memory entities.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { getOrCreateProfile, updateProfile } from "@/src/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  defaultReasoning: z.enum(["fast", "balanced", "deep"]).optional(),
  defaultTools: z.enum(["off", "ask", "allowed"]).optional(),
  defaultPersona: z
    .enum(["auto", "orchestrator", "code_assistant", "brand_designer", "ops", "vision"])
    .optional(),
  preferencesJson: z.string().max(8192).optional(),
});

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("profile.GET", async () => {
    const profile = await getOrCreateProfile(principal.userId);
    return NextResponse.json({ profile });
  });
}

export async function PATCH(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("profile.PATCH", async () => {
    const body = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return sanitizedError("bad_request", 400, parsed.error.format(), "profile.parse");
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName;
    if (parsed.data.defaultReasoning !== undefined) data.defaultReasoning = parsed.data.defaultReasoning;
    if (parsed.data.defaultTools !== undefined) data.defaultTools = parsed.data.defaultTools;
    if (parsed.data.defaultPersona !== undefined) data.defaultPersona = parsed.data.defaultPersona;
    if (parsed.data.preferencesJson !== undefined) data.preferencesJson = parsed.data.preferencesJson;

    const updated = await updateProfile(principal.userId, data);
    return NextResponse.json({ profile: updated });
  });
}
