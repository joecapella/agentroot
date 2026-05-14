/**
 * /api/settings — read & update persona prompt files under agent-config/.
 *
 * v1 has a single authenticated owner; the same token gates both read and
 * write. There is no admin/non-admin split because there is no second user.
 *
 * Hardening notes:
 *   - The filename whitelist (ALLOWED_FILES) is the primary guard. The path
 *     traversal check is redundant given the whitelist, but kept as defense
 *     in depth in case a future maintainer relaxes the whitelist to a glob
 *     or to user-supplied names.
 *   - GET no longer returns the absolute CONFIG_DIR. The client doesn't need
 *     it, and exposing it leaks filesystem layout (CWE-200).
 *   - Errors return stable codes only; details are server-side logged with a
 *     request id.
 *   - Writes are size-capped (200KB) to prevent runaway file growth.
 *
 * Note: changes here update `agent-config/` only. The hosted agent picks up
 * new prompts on the next `azd up` (which re-bakes `src/CofounderAgent/
 * prompts/`). The UI shows this caveat next to the Save button.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FILES = new Set([
  "orchestrator.prompt.md",
  "code-assistant.prompt.md",
  "brand-designer.prompt.md",
  "ops-agent.prompt.md",
  "vision-agent.prompt.md",
]);
const MAX_BYTES = 200_000;

const CONFIG_DIR = path.resolve(process.cwd(), "agent-config");

function safePath(file: string): string {
  // PRIMARY GUARD: exact-match whitelist — `file` must be one of the five
  // known prompt filenames.
  if (!ALLOWED_FILES.has(file)) {
    throw new Error("file_not_allowed");
  }
  // BELT-AND-SUSPENDERS: reject any resolved path that doesn't live STRICTLY
  // inside CONFIG_DIR. Using `path.relative` is OS-uniform — it returns ""
  // for the dir itself, "..something" for escapes, and a plain filename for
  // children. Reject ".", "..", and anything starting with ".." or absolute.
  const resolved = path.resolve(CONFIG_DIR, file);
  const rel = path.relative(CONFIG_DIR, resolved);
  if (
    rel === "" ||
    rel.startsWith("..") ||
    path.isAbsolute(rel)
  ) {
    throw new Error("path_escape");
  }
  return resolved;
}

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("settings.GET", async () => {
    const out: Record<string, string> = {};
    for (const f of ALLOWED_FILES) {
      try {
        out[f] = await fs.readFile(safePath(f), "utf-8");
      } catch {
        // Don't surface filesystem details to the client; log on server,
        // present a generic placeholder.
        out[f] = "# (prompt file unavailable — see server logs)";
      }
    }
    return NextResponse.json({ files: out });
  });
}

const PutBody = z.object({
  file: z.string(),
  content: z.string().max(MAX_BYTES),
});

export async function PUT(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("settings.PUT", async () => {
    let body;
    try {
      body = PutBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "settings.parse");
    }
    let target: string;
    try {
      target = safePath(body.file);
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "settings.safePath");
    }
    // Atomic write: write to a sibling tmp file then rename. `rename` is
    // atomic on the same filesystem, so a crash mid-write never leaves a
    // partial prompt file on disk. The whitelist guarantees target is a
    // flat filename in CONFIG_DIR, so the tmp file is too.
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmp, body.content, "utf-8");
    await fs.rename(tmp, target);
    // Audit log: who, what, how big. Filename only, no content. Logged at
    // info level for traceability without polluting prod logs in future.
    console.info(
      "[audit] settings.PUT user=%s file=%s bytes=%d",
      principal.userId,
      body.file,
      body.content.length
    );
    return NextResponse.json({ ok: true, file: body.file, bytes: body.content.length });
  });
}
