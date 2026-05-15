/**
 * /api/settings/preferences — cost limits, privacy, autonomy flags.
 *
 * GET — current effective UserSettings row (auto-created with defaults).
 * PUT — partial update.
 *
 * These are NOT BYOK keys (see /api/settings/secrets) and NOT identity/
 * UI defaults (see /api/profile). They are the runtime gates: how much
 * you'll let the agent spend, how long messages live, what level of
 * autonomy is acceptable.
 *
 * Storage: the UserSettings table is row-per-user with a uniqueness
 * constraint on userId; defaults match the schema's @default values.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { prisma } from "@/src/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTONOMY_VALUES = ["manual", "balanced", "autonomous"] as const;

const PutBody = z.object({
  monthlySpendLimitUsd: z.number().min(0).max(100_000).optional(),
  dailySpendLimitUsd: z.number().min(0).max(100_000).optional(),
  maxToolCallsPerDay: z.number().int().min(0).max(100_000).optional(),
  maxAgentLoopsPerTurn: z.number().int().min(1).max(100).optional(),
  maxImagesPerDay: z.number().int().min(0).max(10_000).optional(),
  memoryEnabled: z.boolean().optional(),
  factExtractionEnabled: z.boolean().optional(),
  storeToolOutputs: z.boolean().optional(),
  dataRetentionDays: z.number().int().min(0).max(3_650).optional(),
  autonomyLevel: z.enum(AUTONOMY_VALUES).optional(),
  extraJson: z.string().max(16_384).optional(),
});

async function getOrCreateSettings(userId: string) {
  return prisma.userSettings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("settings.preferences.GET", async () => {
    const settings = await getOrCreateSettings(principal.userId);
    return NextResponse.json({ settings });
  });
}

export async function PUT(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("settings.preferences.PUT", async () => {
    let body: z.infer<typeof PutBody>;
    try {
      body = PutBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "settings.preferences.parse");
    }

    // Validate extraJson is parseable JSON before writing.
    if (body.extraJson !== undefined) {
      try {
        JSON.parse(body.extraJson);
      } catch {
        return sanitizedError(
          "bad_request",
          400,
          new Error("extraJson must be valid JSON"),
          "settings.preferences.json",
        );
      }
    }

    // Ensure row exists before update (upsert pattern for partial PUT).
    await getOrCreateSettings(principal.userId);

    const updated = await prisma.userSettings.update({
      where: { userId: principal.userId },
      data: body,
    });

    console.info(
      "[audit] settings.preferences.PUT user=%s fields=%s",
      principal.userId,
      Object.keys(body).join(","),
    );
    return NextResponse.json({ settings: updated });
  });
}
