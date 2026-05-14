/**
 * Filesystem tools for the CofounderAgent.
 *
 * All paths are restricted to a whitelist root to prevent path traversal.
 * Writes require explicit approval through the Approval system.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  renameSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { dirname, join, normalize, relative, resolve, sep as PATH_SEP } from "node:path";
import { createPatch } from "diff";
import { safeReadFileResult } from "./secretsPolicy";

export interface ReadFileResult {
  content: string;
  path: string;
}

export interface ListDirResult {
  entries: Array<{ name: string; type: "file" | "directory" }>;
  path: string;
}

export interface WriteFileResult {
  path: string;
  bytes: number;
}

export interface DiffResult {
  patch: string;
  path: string;
}

/**
 * Resolve the absolute, real (symlink-followed) form of `root` once. We
 * compare against this so a symlink under `root` that points to /etc cannot
 * sneak past the check.
 */
function realRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    // root itself doesn't resolve — refuse outright; better to fail loud.
    throw new Error(`root_unresolvable: ${root}`);
  }
}

/**
 * True iff `candidate` (after symlink resolution where it exists) is inside
 * `root` (also realpath'd). Uses `path.sep` boundary checks so prefix
 * collisions like `/repo` vs `/repo-evil` cannot pass.
 *
 * For paths that don't exist yet (e.g. new file to be created), we realpath
 * the deepest existing ancestor instead and compose the remainder.
 */
function isInsideRoot(candidate: string, root: string): boolean {
  const rRoot = realRoot(root);
  const rRootBoundary = rRoot.endsWith(PATH_SEP) ? rRoot : rRoot + PATH_SEP;

  // Walk up until we find something that exists, then realpath that.
  let walk = candidate;
  let suffix = "";
  // Guard against pathological loops on Windows.
  for (let i = 0; i < 64; i++) {
    if (existsSync(walk)) break;
    const parent = dirname(walk);
    if (parent === walk) break;
    suffix = suffix ? join(walk.slice(parent.length + 1), suffix) : walk.slice(parent.length + 1);
    walk = parent;
  }
  let realCandidate: string;
  try {
    realCandidate = suffix ? join(realpathSync(walk), suffix) : realpathSync(walk);
  } catch {
    // If even the deepest ancestor cannot be resolved, treat as outside.
    return false;
  }

  return realCandidate === rRoot || realCandidate.startsWith(rRootBoundary);
}

function validatePath(requestedPath: string, root: string): string {
  // Reject obviously-absolute paths up front. The old behaviour of stripping
  // a leading slash silently absorbed one level of traversal — Bug-6.
  if (requestedPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(requestedPath)) {
    throw new Error(`path_traversal: absolute path "${requestedPath}" is not allowed`);
  }
  const normalized = normalize(requestedPath);
  // Reject explicit parent traversal in the *requested* form, before resolve
  // has a chance to absorb it.
  if (normalized.split(/[\\/]/).includes("..")) {
    throw new Error(`path_traversal: "${requestedPath}" contains parent segments`);
  }
  const full = resolve(root, normalized);
  if (!isInsideRoot(full, root)) {
    throw new Error(`path_traversal: "${requestedPath}" resolves outside the allowed root`);
  }
  return full;
}

/** Read a text file within the repo root. */
export function readFileTool(args: { path: string; repoRoot: string }): ReadFileResult {
  const fullPath = validatePath(args.path, args.repoRoot);
  if (!existsSync(fullPath)) {
    throw new Error(`file_not_found: ${args.path}`);
  }
  const stat = statSync(fullPath);
  if (stat.isDirectory()) {
    throw new Error(`is_directory: ${args.path}`);
  }
  const rawContent = readFileSync(fullPath, "utf-8");
  const safety = safeReadFileResult(args.path, rawContent);
  if (!safety.allowed) {
    // Return redacted content so the agent can see it was blocked
    return { content: safety.redacted, path: args.path };
  }
  return { content: safety.redacted, path: args.path };
}

/** List directory contents within the repo root. */
export function listDirectoryTool(args: { path: string; repoRoot: string }): ListDirResult {
  const fullPath = validatePath(args.path, args.repoRoot);
  if (!existsSync(fullPath)) {
    throw new Error(`directory_not_found: ${args.path}`);
  }
  const entries = readdirSync(fullPath, { withFileTypes: true }).map((d) => ({
    name: d.name,
    type: (d.isDirectory() ? "directory" : "file") as "file" | "directory",
  }));
  return { entries, path: args.path };
}

/** Write a file (destructive). Creates parent directories if needed. */
export function writeFileTool(args: { path: string; content: string; repoRoot: string }): WriteFileResult {
  const fullPath = validatePath(args.path, args.repoRoot);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(fullPath, args.content, "utf-8");
  return { path: args.path, bytes: Buffer.byteLength(args.content, "utf-8") };
}

/** Generate a unified diff between old and new content. */
export function generateDiff(args: { path: string; oldContent: string; newContent: string }): DiffResult {
  const patch = createPatch(args.path, args.oldContent, args.newContent, "old", "new", { context: 3 });
  return { patch, path: args.path };
}

/** Apply a search/replace block to a file. */
export function applySearchReplace(args: { path: string; search: string; replace: string; repoRoot: string }): WriteFileResult {
  const fullPath = validatePath(args.path, args.repoRoot);
  if (!existsSync(fullPath)) {
    throw new Error(`file_not_found: ${args.path}`);
  }
  const content = readFileSync(fullPath, "utf-8");
  if (!content.includes(args.search)) {
    throw new Error(`search_not_found: the search block was not found in ${args.path}`);
  }
  const newContent = content.replace(args.search, args.replace);
  // Only replace first occurrence to avoid unintended changes.
  writeFileSync(fullPath, newContent, "utf-8");
  return { path: args.path, bytes: Buffer.byteLength(newContent, "utf-8") };
}

/** Create a rollback snapshot directory. */
export function createRollbackSnapshot(args: { paths: string[]; repoRoot: string; snapshotDir: string }): { snapshotDir: string } {
  mkdirSync(args.snapshotDir, { recursive: true });
  for (const p of args.paths) {
    const fullPath = validatePath(p, args.repoRoot);
    if (existsSync(fullPath)) {
      const snapPath = join(args.snapshotDir, p);
      mkdirSync(dirname(snapPath), { recursive: true });
      const content = readFileSync(fullPath);
      writeFileSync(snapPath, content);
    }
  }
  return { snapshotDir: args.snapshotDir };
}

/** Restore files from a rollback snapshot. */
export function restoreRollback(args: { snapshotDir: string; repoRoot: string }): void {
  if (!existsSync(args.snapshotDir)) {
    throw new Error(`snapshot_not_found: ${args.snapshotDir}`);
  }
  // Walk snapshot dir and copy files back.
  function walk(dir: string, rel: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const snapPath = join(dir, entry.name);
      const targetRel = join(rel, entry.name);
      const targetPath = join(args.repoRoot, targetRel);
      if (entry.isDirectory()) {
        walk(snapPath, targetRel);
      } else {
        mkdirSync(dirname(targetPath), { recursive: true });
        const content = readFileSync(snapPath);
        writeFileSync(targetPath, content);
      }
    }
  }
  walk(args.snapshotDir, "");
}
