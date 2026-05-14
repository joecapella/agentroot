/**
 * File-path autocomplete for `@`-mention in the chat input.
 *
 * Walks the configured local repo (REPO_ROOT) and returns matching relative
 * file paths for a fuzzy prefix query. Local-only v1 is single-user, but this
 * route still scopes cache entries by principal + root and fails closed if
 * REPO_ROOT is unset so the endpoint cannot accidentally enumerate an
 * arbitrary process cwd in a hosted/multi-user deployment.
 *
 * GET /api/files/search?q=foun&limit=20
 *   → { matches: string[] }
 *
 * This endpoint is intentionally read-only. It never returns file contents.
 */

import { NextRequest, NextResponse } from "next/server";
import { readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep as PATH_SEP } from "node:path";
import { requireAuth, SERVER_USER_ID, type Principal } from "@/src/server/auth";
import { runRoute } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  ".azure",
  ".venv",
  "__pycache__",
  "prisma/migrations",
]);

const SENSITIVE_FILE_RE = /(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_dsa|id_ecdsa|id_ed25519|.*\.(?:pem|key|p12|pfx|crt|cer)|.*(?:secret|credential|credentials|token|passwd|password).*)$/i;

/** Max files we'll enumerate before bailing — keeps `@` autocomplete snappy. */
const MAX_WALK_ENTRIES = 5000;
const CACHE_TTL_MS = 30_000;

type CacheEntry = { files: string[]; at: number };
const fileCache = new Map<string, CacheEntry>();

function realRoot(root: string): string {
  return realpathSync(root);
}

function isInsideRoot(realPath: string, root: string): boolean {
  const rootBoundary = root.endsWith(PATH_SEP) ? root : root + PATH_SEP;
  return realPath === root || realPath.startsWith(rootBoundary);
}

function shouldIgnoreRel(rel: string, isDir: boolean): boolean {
  const normalized = rel.split(PATH_SEP).join("/");
  const top = normalized.split("/")[0];
  if (IGNORE_DIRS.has(top) || IGNORE_DIRS.has(normalized)) return true;
  if (isDir && normalized.split("/").some((part) => part.startsWith("."))) return true;
  return SENSITIVE_FILE_RE.test(normalized);
}

function walkRepo(root: string): string[] {
  const rootReal = realRoot(root);
  const out: string[] = [];
  const stack: string[] = [rootReal];
  const visited = new Set<string>([rootReal]);

  while (stack.length && out.length < MAX_WALK_ENTRIES) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const abs = join(dir, e.name);
      let realAbs: string;
      try {
        // Resolve symlinks before classifying or returning paths. If a future
        // platform follows symlinked directories via Dirent, this still blocks
        // loops and escapes.
        realAbs = realpathSync(abs);
      } catch {
        continue;
      }
      if (!isInsideRoot(realAbs, rootReal)) continue;

      const rel = relative(rootReal, realAbs);
      if (!rel || rel.startsWith("..") || rel.includes(`..${PATH_SEP}`)) continue;

      if (e.isDirectory()) {
        if (shouldIgnoreRel(rel, true)) continue;
        if (visited.has(realAbs)) continue;
        visited.add(realAbs);
        stack.push(realAbs);
      } else if (e.isFile()) {
        if (shouldIgnoreRel(rel, false)) continue;
        out.push(rel);
      }
    }
  }
  return out;
}

/** Naive fuzzy: lowercase substring match, prefer prefix matches, cap N. */
function fuzzyMatch(files: string[], query: string, limit: number): string[] {
  const q = query.toLowerCase();
  if (!q) return files.slice(0, limit);
  const prefix: string[] = [];
  const substr: string[] = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    if (lower.startsWith(q)) prefix.push(f);
    else if (lower.includes(q)) substr.push(f);
    if (prefix.length + substr.length >= limit * 3) break;
  }
  return [...prefix, ...substr].slice(0, limit);
}

function configuredRepoRoot(): string {
  const raw = process.env.REPO_ROOT;
  if (!raw) {
    throw new Error("repo_root_not_configured: REPO_ROOT is required for file autocomplete");
  }
  return resolve(raw);
}

function requireRepoAccess(principal: Principal, root: string): void {
  // Local-only v1: Joseph is the only principal allowed to enumerate the
  // configured repo root. Keeping this explicit prevents a future hosted auth
  // swap from turning mere login into filesystem enumeration permission.
  void root;
  if (principal.userId !== SERVER_USER_ID) {
    throw new Error("repo_access_denied");
  }
}

function getFiles(root: string, userId: string): string[] {
  const rootReal = realRoot(root);
  const cacheKey = `${userId}:${rootReal}`;
  const now = Date.now();
  const cached = fileCache.get(cacheKey);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.files;

  const files = walkRepo(rootReal);
  fileCache.set(cacheKey, { files, at: now });
  return files;
}

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("files.search.GET", async () => {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").slice(0, 200);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1),
      50,
    );
    const root = configuredRepoRoot();
    requireRepoAccess(principal, root);
    const files = getFiles(root, principal.userId);
    const matches = fuzzyMatch(files, q, limit);
    return NextResponse.json({ matches });
  });
}
