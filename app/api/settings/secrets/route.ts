/**
 * /api/settings/secrets — server-side BYOK key vault.
 *
 * GET    /api/settings/secrets
 *   List the user's stored secrets. Returns metadata ONLY — provider,
 *   redactedPreview, lastVerifiedAt, rotatedAt. Plaintext never crosses
 *   this boundary.
 *
 * POST   /api/settings/secrets
 *   Body: { provider, value, metadata?, test? }
 *   Encrypts value under APP_ENCRYPTION_KEY, upserts the row, optionally
 *   probes the provider with the plaintext (test=true) and stores
 *   lastVerifiedAt on success. The plaintext is held only in the request
 *   scope and never logged.
 *
 * DELETE /api/settings/secrets?provider=openai
 *   Removes the row entirely.
 *
 * Auth: requireAuth + requireSameOriginHeader. Local-only today, but the
 * exact same primitives apply if we ever go hosted.
 *
 * Threat model
 * ------------
 * Plaintext is exposed only in:
 *   - POST request body (TLS-protected once hosted).
 *   - The optional provider probe call (TLS to provider).
 *   - The decrypt-on-use path in /api/chat (separate file).
 * It is NEVER:
 *   - Returned in GET responses.
 *   - Echoed back from POST responses on success or failure.
 *   - Logged (console statements use principal.userId + provider only).
 *   - Persisted as plaintext anywhere — encryption is mandatory; if the
 *     vault is unavailable (missing APP_ENCRYPTION_KEY) the route 503s.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { prisma } from "@/src/prisma";
import {
  encryptSecret,
  buildRedactedPreview,
  isVaultAvailable,
  VaultUnavailableError,
} from "@/src/server/secretsVault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Providers we currently accept. Extend cautiously — every new provider
 *  needs both a runtime route in modelRouting AND a probe handler below.
 *  Adding a key here that the chat path doesn't read is the "fake UI"
 *  trap we explicitly want to avoid. */
const PROVIDER_VALUES = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
] as const;
type Provider = (typeof PROVIDER_VALUES)[number];

const SECRET_MAX_CHARS = 512;
const META_MAX_CHARS = 2048;

const PostBody = z.object({
  provider: z.enum(PROVIDER_VALUES),
  value: z.string().min(8).max(SECRET_MAX_CHARS),
  // Optional non-secret metadata (org id, base URL override, etc.).
  metadata: z.record(z.string(), z.string().max(512)).optional(),
  // If true, probe the provider with the plaintext before persisting.
  // On probe failure we DO NOT save — better to reject a typo than to
  // store a broken key that quietly fails every request.
  test: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("settings.secrets.GET", async () => {
    const rows = await prisma.userSecret.findMany({
      where: { userId: principal.userId },
      select: {
        provider: true,
        label: true,
        redactedPreview: true,
        metadataJson: true,
        lastVerifiedAt: true,
        rotatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { provider: "asc" },
    });
    const secrets = rows.map((r) => ({
      ...r,
      metadata: safeParseObject(r.metadataJson),
    }));
    return NextResponse.json({ secrets, vaultAvailable: isVaultAvailable() });
  });
}

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("settings.secrets.POST", async () => {
    // Vault must be live BEFORE we read the body — gives the user a clear
    // error and avoids hashing/encrypting against a half-configured env.
    if (!isVaultAvailable()) {
      return sanitizedError(
        "vault_unavailable",
        503,
        new Error("APP_ENCRYPTION_KEY missing or malformed"),
        "settings.secrets.vault",
      );
    }

    let body: z.infer<typeof PostBody>;
    try {
      body = PostBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "settings.secrets.parse");
    }

    const metaJson = JSON.stringify(body.metadata ?? {});
    if (metaJson.length > META_MAX_CHARS) {
      return sanitizedError("bad_request", 400, new Error("metadata too large"), "settings.secrets.meta");
    }

    const plaintext = body.value.trim();
    if (plaintext.length < 8) {
      return sanitizedError("bad_request", 400, new Error("value too short"), "settings.secrets.value");
    }

    // Optional probe BEFORE writing. Plaintext stays in this function scope.
    let verified: Date | null = null;
    if (body.test) {
      const probe = await probeProvider(body.provider, plaintext, body.metadata);
      if (!probe.ok) {
        // Audit log — provider + reason, never the key.
        console.info(
          "[audit] settings.secrets.POST verify failed user=%s provider=%s reason=%s",
          principal.userId,
          body.provider,
          probe.reason,
        );
        return NextResponse.json(
          { error: "provider_rejected_key", reason: probe.reason },
          { status: 400 },
        );
      }
      verified = new Date();
    }

    let encrypted: string;
    try {
      encrypted = encryptSecret(plaintext);
    } catch (err) {
      if (err instanceof VaultUnavailableError) {
        return sanitizedError("vault_unavailable", 503, err, "settings.secrets.encrypt");
      }
      throw err;
    }
    const preview = buildRedactedPreview(plaintext);

    await prisma.userSecret.upsert({
      where: {
        userId_provider_label: {
          userId: principal.userId,
          provider: body.provider,
          label: "default",
        },
      },
      update: {
        encryptedValue: encrypted,
        redactedPreview: preview,
        metadataJson: metaJson,
        rotatedAt: new Date(),
        lastVerifiedAt: verified ?? undefined,
      },
      create: {
        userId: principal.userId,
        provider: body.provider,
        label: "default",
        encryptedValue: encrypted,
        redactedPreview: preview,
        metadataJson: metaJson,
        lastVerifiedAt: verified,
      },
    });

    console.info(
      "[audit] settings.secrets.POST user=%s provider=%s verified=%s",
      principal.userId,
      body.provider,
      verified ? "yes" : "skipped",
    );

    return NextResponse.json({
      ok: true,
      provider: body.provider,
      redactedPreview: preview,
      lastVerifiedAt: verified,
    });
  });
}

export async function DELETE(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("settings.secrets.DELETE", async () => {
    const url = new URL(req.url);
    const provider = url.searchParams.get("provider");
    if (!provider || !PROVIDER_VALUES.includes(provider as Provider)) {
      return sanitizedError("bad_request", 400, new Error("unknown provider"), "settings.secrets.delete.parse");
    }
    const res = await prisma.userSecret.deleteMany({
      where: {
        userId: principal.userId,
        provider,
        label: "default",
      },
    });
    console.info(
      "[audit] settings.secrets.DELETE user=%s provider=%s count=%d",
      principal.userId,
      provider,
      res.count,
    );
    return NextResponse.json({ ok: true, deleted: res.count });
  });
}

// ---------------------------------------------------------------------------
// Provider probes — minimal, non-billable round-trips to validate a key.
// Each probe:
//   - has a 5s timeout (an unresponsive provider should not block save)
//   - returns { ok, reason } only — never echoes the key in any form
//   - distinguishes auth failures (401/403) from network errors
// ---------------------------------------------------------------------------

interface ProbeResult { ok: boolean; reason?: string }

async function probeProvider(
  provider: Provider,
  apiKey: string,
  metadata?: Record<string, string>,
): Promise<ProbeResult> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 5_000);
  try {
    switch (provider) {
      case "openai":
        return await probeOpenAI(apiKey, ac.signal);
      case "anthropic":
        return await probeAnthropic(apiKey, ac.signal);
      case "gemini":
        return await probeGemini(apiKey, ac.signal);
      case "openrouter":
        return await probeOpenRouter(apiKey, metadata, ac.signal);
      default:
        return { ok: false, reason: "unknown_provider" };
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeOpenAI(apiKey: string, signal: AbortSignal): Promise<ProbeResult> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized" };
  return { ok: false, reason: `http_${res.status}` };
}

async function probeAnthropic(apiKey: string, signal: AbortSignal): Promise<ProbeResult> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal,
  });
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized" };
  return { ok: false, reason: `http_${res.status}` };
}

async function probeGemini(apiKey: string, signal: AbortSignal): Promise<ProbeResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { signal },
  );
  if (res.ok) return { ok: true };
  if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized" };
  return { ok: false, reason: `http_${res.status}` };
}

async function probeOpenRouter(
  apiKey: string,
  metadata: Record<string, string> | undefined,
  signal: AbortSignal,
): Promise<ProbeResult> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(metadata?.site ? { "HTTP-Referer": metadata.site } : {}),
      ...(metadata?.app ? { "X-Title": metadata.app } : {}),
    },
    signal,
  });
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized" };
  return { ok: false, reason: `http_${res.status}` };
}

function safeParseObject(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
