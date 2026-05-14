/**
 * Git operations for the CofounderAgent.
 *
 * Read-only by default; push/write ops are blocked.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { normalize, relative, resolve } from "node:path";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function validateInsideRoot(target: string, root: string): string {
  const full = resolve(root, normalize(target).replace(/^\//, ""));
  const rel = relative(root, full);
  if (rel.startsWith("..") || rel.startsWith("/")) {
    throw new Error(`path_traversal: ${target} is outside the allowed root`);
  }
  return full;
}

async function git(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf-8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf-8");
    });
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
    child.on("error", reject);
  });
}

export async function gitStatusTool(args: {
  cwd?: string;
  repoRoot: string;
}): Promise<GitResult> {
  const cwd = validateInsideRoot(args.cwd ?? ".", args.repoRoot);
  return git(["status", "--short"], cwd);
}

export async function gitDiffTool(args: {
  cwd?: string;
  repoRoot: string;
  target?: string;
}): Promise<GitResult> {
  const cwd = validateInsideRoot(args.cwd ?? ".", args.repoRoot);
  const target = args.target ?? "HEAD";
  return git(["diff", target], cwd);
}

export async function gitLogTool(args: {
  cwd?: string;
  repoRoot: string;
  n?: number;
}): Promise<GitResult> {
  const cwd = validateInsideRoot(args.cwd ?? ".", args.repoRoot);
  const n = Math.min(args.n ?? 10, 50);
  return git(["log", `--max-count=${n}`, "--oneline"], cwd);
}

export async function gitBranchTool(args: {
  cwd?: string;
  repoRoot: string;
}): Promise<GitResult> {
  const cwd = validateInsideRoot(args.cwd ?? ".", args.repoRoot);
  return git(["branch", "-vv"], cwd);
}

export async function gitShowTool(args: {
  cwd?: string;
  repoRoot: string;
  ref: string;
}): Promise<GitResult> {
  const cwd = validateInsideRoot(args.cwd ?? ".", args.repoRoot);
  // Sanitize ref to avoid command injection
  const safeRef = args.ref.replace(/[^a-zA-Z0-9._\-\/]/g, "");
  return git(["show", "--stat", safeRef], cwd);
}
