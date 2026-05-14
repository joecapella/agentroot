/**
 * Code search tools — grep and find across the repo.
 *
 * Uses ripgrep when available, falls back to Node builtins.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { normalize, relative, resolve } from "node:path";

export interface CodeSearchResult {
  path: string;
  line: number;
  text: string;
}

function validateInsideRoot(target: string, root: string): string {
  const full = resolve(root, normalize(target).replace(/^\//, ""));
  const rel = relative(root, full);
  if (rel.startsWith("..") || rel.startsWith("/")) {
    throw new Error(`path_traversal: ${target} is outside the allowed root`);
  }
  return full;
}

export async function grepTool(args: {
  pattern: string;
  path?: string;
  repoRoot: string;
  maxResults?: number;
}): Promise<{ results: CodeSearchResult[]; truncated: boolean }> {
  const cwd = validateInsideRoot(args.path ?? ".", args.repoRoot);
  const maxResults = Math.min(args.maxResults ?? 50, 200);

  const hasRg = existsSync("/usr/bin/rg") || existsSync("/usr/local/bin/rg");

  return new Promise((resolve, reject) => {
    const cmd = hasRg
      ? ["rg", "--json", "--max-count", String(maxResults + 1), "-n", args.pattern, "."]
      : ["grep", "-rn", "--max-count=" + String(maxResults + 1), args.pattern, "."];

    const child = spawn(cmd[0], cmd.slice(1), {
      cwd,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf-8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf-8");
    });

    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        // grep returns 1 when no matches; that's fine.
        return reject(new Error(`grep failed: ${stderr || code}`));
      }

      const results: CodeSearchResult[] = [];
      const lines = stdout.split("\n").filter(Boolean);

      if (hasRg) {
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "match") {
              const m = obj.data;
              const path = m.path?.text ?? "";
              for (const sub of m.submatches ?? []) {
                const lineNum = m.line_number ?? 0;
                const text = sub.match?.text ?? "";
                results.push({ path, line: lineNum, text });
              }
            }
          } catch {
            // ignore parse errors
          }
        }
      } else {
        // grep -rn format: path:line:text
        for (const line of lines) {
          const m = line.match(/^(.+?):(\d+):(.*)$/);
          if (m) {
            results.push({ path: m[1], line: parseInt(m[2], 10), text: m[3] });
          }
        }
      }

      const truncated = results.length > maxResults;
      resolve({ results: results.slice(0, maxResults), truncated });
    });

    child.on("error", reject);
  });
}

export async function findFilesTool(args: {
  pattern: string;
  repoRoot: string;
  maxResults?: number;
}): Promise<{ paths: string[]; truncated: boolean }> {
  const maxResults = Math.min(args.maxResults ?? 50, 200);

  return new Promise((resolve, reject) => {
    const child = spawn("find", [args.repoRoot, "-name", args.pattern, "-type", "f"], {
      shell: false,
    });

    let stdout = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf-8");
    });
    child.on("close", () => {
      const all = stdout
        .split("\n")
        .map((s) => relative(args.repoRoot, s))
        .filter(Boolean);
      const truncated = all.length > maxResults;
      resolve({ paths: all.slice(0, maxResults), truncated });
    });
    child.on("error", reject);
  });
}
