/**
 * Command safety policy for run_command.
 *
 * Allowlist + denylist approach. Commands must match the allowlist
 * AND not match the denylist.
 */

export interface CommandValidationResult {
  allowed: boolean;
  reason?: string;
  safeCommand?: string;
}

// Allowed base commands (exact match on first word)
const ALLOWED_BASE = new Set([
  "npm",
  "npx",
  "yarn",
  "pnpm",
  "git",
  "python",
  "python3",
  "pytest",
  "tsc",
  "eslint",
  "az",
  "docker",
  "docker-compose",
  "make",
  "cargo",
  "go",
  "rustc",
  "node",
  "tsx",
  "prisma",
]);

// Dangerous patterns that are blocked regardless of base command.
// shell:true is used by runCommandTool so attackers can chain via
// `;`, `&&`, `||`, backticks, `$()`. We block shell-chaining metachars
// outright; complex multi-step commands should be split into multiple
// run_command calls (which the agent loop can do).
const DENYLIST_PATTERNS = [
  /rm\s+-[rf]+/,                  // rm -rf, rm -r -f
  />\s*\/dev\//,                  // redirect to /dev/
  /curl\s+.*\|\s*(ba)?sh/,        // curl | bash
  /wget\s+.*\|\s*(ba)?sh/,        // wget | bash
  /\bsudo\b/,                     // sudo
  /chmod\s+-R\s+777/,             // chmod -R 777
  /\bmkfs\b/,                     // format filesystems
  /\bdd\s+if=/,                   // dd disk writes
  /:\(\)\s*\{\s*:\|:&\s*\};:/,    // fork bomb
  /mv\s+.*\s+\/dev\/null/,        // mv to null
  /\|\s*rm\b/,                    // pipe to rm
  /\brm\s+-r\b/,                  // rm -r anywhere
  // Shell-chaining metachars (review-Bug-S1). These let a benign-looking
  // allowlisted prefix (`npm install`) smuggle arbitrary commands.
  /;\s*\S/,                       // semicolon chain
  /&&|\|\|/,                      // && and ||
  /`[^`]+`/,                      // backtick command substitution
  /\$\([^)]+\)/,                  // $(…) command substitution
  /^\s*\(/,                       // grouping subshell
];

export function validateCommand(command: string): CommandValidationResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return { allowed: false, reason: "Empty command" };
  }

  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();

  // Check allowlist
  if (!ALLOWED_BASE.has(firstWord)) {
    return {
      allowed: false,
      reason: `Command '${firstWord}' is not in the allowlist. Allowed: ${Array.from(ALLOWED_BASE).sort().join(", ")}`,
    };
  }

  // Check denylist patterns
  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason: `Command matches dangerous pattern: ${pattern.source}`,
      };
    }
  }

  return { allowed: true, safeCommand: trimmed };
}
