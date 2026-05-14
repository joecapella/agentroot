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
  email: z.string().email().max(200).optional().or(z.literal("")),
  defaultReasoning: z.enum(["fast", "balanced", "deep"]).optional(),
  defaultTools: z.enum(["off", "ask", "allowed"]).optional(),
  defaultPersona: z
    .enum(["auto", "orchestrator", "code_assistant", "brand_designer", "ops", "vision"])
    .optional(),
  preferencesJson: z.string().max(16384).optional(),
  identityDocument: z.string().max(4000).optional(),
  defaultImageQuality: z.enum(["auto", "low", "medium", "high"]).optional(),
  defaultImageSize: z.enum(["auto", "1024x1024", "1024x1536", "1536x1024"]).optional(),
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
    if (parsed.data.email !== undefined) data.email = parsed.data.email || null;
    if (parsed.data.defaultReasoning !== undefined) data.defaultReasoning = parsed.data.defaultReasoning;
    if (parsed.data.defaultTools !== undefined) data.defaultTools = parsed.data.defaultTools;
    if (parsed.data.defaultPersona !== undefined) data.defaultPersona = parsed.data.defaultPersona;

    // Merge preference-related fields into preferencesJson atomically.
    const prefsFields = ["preferencesJson", "identityDocument", "defaultImageQuality", "defaultImageSize"] as const;
    const hasPrefsUpdate = prefsFields.some((k) => parsed.data[k] !== undefined);
    if (hasPrefsUpdate) {
      const profile = await getOrCreateProfile(principal.userId);
      let prefs: Record<string, unknown> = {};
      try {
        prefs = JSON.parse(profile.preferencesJson || "{}");
      } catch {
        // ignore malformed json
      }
      if (parsed.data.preferencesJson !== undefined) {
        try {
          prefs = JSON.parse(parsed.data.preferencesJson);
        } catch {
          // if raw string provided, keep existing
        }
      }
      if (parsed.data.identityDocument !== undefined) {
        prefs.identityDocument = parsed.data.identityDocument;
      }
      if (parsed.data.defaultImageQuality !== undefined) {
        prefs.defaultImageQuality = parsed.data.defaultImageQuality;
      }
      if (parsed.data.defaultImageSize !== undefined) {
        prefs.defaultImageSize = parsed.data.defaultImageSize;
      }
      data.preferencesJson = JSON.stringify(prefs);
    }

    const updated = await updateProfile(principal.userId, data);
    return NextResponse.json({ profile: updated });
  });
}
