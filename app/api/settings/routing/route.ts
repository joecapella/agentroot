/**
 * GET|PUT /api/settings/routing — user-defined model routing overrides.
 *
 * Overrides are stored inside UserProfile.preferencesJson so we don't need
 * a schema migration. The chat route reads them and passes them to
 * resolveRouteForTaskWithOverrides().
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { getOrCreateProfile } from "@/src/memory";
import { ROUTES } from "@/src/modelRouting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OVERRIDE_KEY = "modelRoutingOverrides";

/** All logical model names that can be used as overrides. */
const VALID_LOGICAL_MODELS = new Set([
  "gpt-5.5",
  "gpt-4.1",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "deepseek-v4-flash",
  "kimi-k2.6",
  "gpt-image-2",
  "gemini-pro",
  "gemini-flash",
  "ollama-coder",
  "ollama-fast",
  "ollama-deep",
  "byok-openai-chat",
  "byok-openai-mini",
  "byok-anthropic",
  "byok-gemini",
]);

const PutBody = z.object({
  overrides: z.record(z.string().nullable()),
});

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("settings.routing.GET", async () => {
    const profile = await getOrCreateProfile(principal.userId);
    let overrides: Record<string, string | null> = {};
    try {
      const prefs = JSON.parse(profile.preferencesJson || "{}");
      if (prefs[OVERRIDE_KEY] && typeof prefs[OVERRIDE_KEY] === "object") {
        overrides = prefs[OVERRIDE_KEY];
      }
    } catch {
      // ignore malformed json
    }

    return NextResponse.json({
      overrides,
      defaults: ROUTES,
      availableModels: Array.from(VALID_LOGICAL_MODELS),
    });
  });
}

export async function PUT(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("settings.routing.PUT", async () => {
    let body;
    try {
      body = PutBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "settings.routing.parse");
    }

    const validTasks = new Set(Object.keys(ROUTES));
    for (const [task, model] of Object.entries(body.overrides)) {
      if (!validTasks.has(task)) {
        return sanitizedError("bad_request", 400, `Unknown task kind: ${task}`, "settings.routing.validate");
      }
      if (model !== null && !VALID_LOGICAL_MODELS.has(model)) {
        return sanitizedError("bad_request", 400, `Unknown model: ${model}`, "settings.routing.validate");
      }
    }

    const profile = await getOrCreateProfile(principal.userId);
    let prefs: Record<string, unknown> = {};
    try {
      prefs = JSON.parse(profile.preferencesJson || "{}");
    } catch {
      // ignore malformed json
    }

    // Remove null entries (means "use default")
    const cleaned: Record<string, string> = {};
    for (const [task, model] of Object.entries(body.overrides)) {
      if (model !== null) cleaned[task] = model;
    }

    prefs[OVERRIDE_KEY] = cleaned;

    await prisma.userProfile.update({
      where: { userId: principal.userId },
      data: { preferencesJson: JSON.stringify(prefs) },
    });

    return NextResponse.json({ overrides: cleaned });
  });
}
