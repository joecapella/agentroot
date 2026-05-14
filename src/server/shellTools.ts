/**
 * Shell execution tools for the CofounderAgent.
 *
 * Restricted to the repo root. Timeout enforced. stdout/stderr captured.
 * Commands validated against allowlist + denylist.
 */

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep as PATH_SEP } from "node:path";
import { validateCommand } from "./commandPolicy";

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function realRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    throw new Error(`root_unresolvable: ${root}`);
  }
}

function isInsideRoot(candidate: string, root: string): boolean {
  const rRoot = realRoot(root);
  const boundary = rRoot.endsWith(PATH_SEP) ? rRoot : rRoot + PATH_SEP;
  let walk = candidate;
  let suffix = "";
  for (let i = 0; i < 64; i++) {
    if (existsSync(walk)) break;
    const parent = dirname(walk);
    if (parent === walk) break;
    suffix = suffix ? join(walk.slice(parent.length + 1), suffix) : walk.slice(parent.length + 1);
    walk = parent;
  }
  let real: string;
  try {
    real = suffix ? join(realpathSync(walk), suffix) : realpathSync(walk);
  } catch {
    return false;
  }
  return real === rRoot || real.startsWith(boundary);
}

function validateCwd(requestedCwd: string, root: string): string {
  if (requestedCwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(requestedCwd)) {
    throw new Error(`path_traversal: absolute cwd "${requestedCwd}" is not allowed`);
  }
  const normalized = normalize(requestedCwd);
  if (normalized.split(/[\\/]/).includes("..")) {
    throw new Error(`path_traversal: cwd "${requestedCwd}" contains parent segments`);
  }
  const full = resolve(root, normalized);
  if (!isInsideRoot(full, root)) {
    throw new Error(`path_traversal: cwd "${requestedCwd}" resolves outside the allowed root`);
  }
  if (!existsSync(full)) {
    throw new Error(`cwd_not_found: ${requestedCwd}`);
  }
  return full;
}

export async function runCommandTool(args: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  repoRoot: string;
}): Promise<RunCommandResult> {
  // Validate command against allowlist/denylist
  const validation = validateCommand(args.command);
  if (!validation.allowed) {
    throw new Error(`command_blocked: ${validation.reason}`);
  }

  const cwd = validateCwd(args.cwd ?? ".", args.repoRoot);
  const timeoutMs = Math.min(args.timeoutMs ?? 30_000, 120_000);

  return new Promise((resolve, reject) => {
    const child = spawn(args.command, [], {
      shell: true,
      cwd,
      env: { ...process.env, PATH: process.env.PATH },
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`command_timeout: exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString("utf-8");
      if (stdout.length > 500_000) {
        stdout = stdout.slice(0, 500_000) + "\n[truncated at 500KB]";
        child.stdout?.pause();
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
      if (stderr.length > 500_000) {
        stderr = stderr.slice(0, 500_000) + "\n[truncated at 500KB]";
        child.stderr?.pause();
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode });
    });
  });
}
