/**
 * Secrets leakage protection.
 *
 * Blocks reads of known secret files and redacts potential secrets
 * from tool outputs before they reach the LLM or DB.
 */

import { basename } from "node:path";

// File patterns that should never be read
const SECRET_FILE_PATTERNS = [
  /^\.env$/,
  /^\.env\.\w+$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /secret/i,
  /private/i,
  /credential/i,
  /token/i,
  /password/i,
  /apikey/i,
  /_key$/,
  /^id_rsa/,
  /^id_ed25519/,
  /^id_ecdsa/,
  /\.htpasswd/,
  /\.netrc/,
  /\.npmrc/,
  /\.docker\/config\.json/,
];

// Patterns that look like secrets in text. Order matters only for
// readability — every pattern is run on every redaction.
const SECRET_VALUE_PATTERNS = [
  // Generic key=value style
  /[Aa][Pp][Ii][_\-]?[Kk][Ee][Yy]\s*[:=]\s*["']?[a-zA-Z0-9_\-]{16,}["']?/g,
  /[Ss][Ee][Cc][Rr][Ee][Tt]\s*[:=]\s*["']?[a-zA-Z0-9_\-]{8,}["']?/g,
  /[Tt][Oo][Kk][Ee][Nn]\s*[:=]\s*["']?[a-zA-Z0-9_\-]{8,}["']?/g,
  /[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]\s*[:=]\s*["']?[^\s"']{8,}["']?/g,
  /[Bb][Ee][Aa][Rr][Ee][Rr]\s+[a-zA-Z0-9_\-\.]{20,}/g,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  // Provider-specific (expanded 2026-05-14 — review-Bug-4.5)
  /sk-[a-zA-Z0-9_\-]{20,}/g,                            // OpenAI legacy + project keys
  /\bsk-proj-[A-Za-z0-9_\-]{20,}\b/g,                    // OpenAI project keys
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,                     // GitHub PATs (gho_/ghp_/ghs_/ghu_/ghr_)
  /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g,                   // GitHub fine-grained PATs
  /\bglpat-[A-Za-z0-9_\-]{20,}\b/g,                      // GitLab PATs
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,                   // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                               // AWS access key id
  /\bASIA[0-9A-Z]{16}\b/g,                               // AWS temporary access key id
  /\bAIza[0-9A-Za-z_\-]{35}\b/g,                         // Google API keys
  /\bya29\.[0-9A-Za-z_\-]{20,}\b/g,                      // Google OAuth tokens
  /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, // JWTs
  /\bnpm_[A-Za-z0-9]{30,}\b/g,                           // npm tokens
  /\bhf_[A-Za-z0-9]{30,}\b/g,                            // HuggingFace tokens
  /\bSG\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\b/g,   // SendGrid
  /\b[a-z0-9]{20,}:[a-z0-9]{30,}@/g,                     // basic-auth style creds in URLs
];

export function isSecretFile(path: string): boolean {
  const name = basename(path);
  return SECRET_FILE_PATTERNS.some((p) => p.test(name));
}

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const prefix = match.slice(0, Math.min(4, match.length));
      return `${prefix}[REDACTED]`;
    });
  }
  return result;
}

export function safeReadFileResult(path: string, content: string): { allowed: boolean; redacted: string; reason?: string } {
  if (isSecretFile(path)) {
    return {
      allowed: false,
      redacted: "[REDACTED: secret file]",
      reason: `Reading '${path}' is blocked because it may contain secrets.`,
    };
  }
  return {
    allowed: true,
    redacted: redactSecrets(content),
  };
}
