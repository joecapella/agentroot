/**
 * Secrets vault — AES-256-GCM wrap/unwrap for user-supplied API keys.
 *
 * Why this exists
 * ---------------
 * BYOK keys (OpenAI, Anthropic, Gemini, etc.) MUST be encrypted at rest.
 * Pasting them as plaintext into the SQLite file would mean any backup,
 * any `prisma studio` glance, or any future leak permanently exposes
 * every user's external account. AES-GCM gives us confidentiality AND
 * tamper-detection — if anyone modifies the ciphertext or auth tag, decrypt
 * throws, and we treat the row as compromised.
 *
 * Key material
 * ------------
 * APP_ENCRYPTION_KEY must be a 32-byte value, supplied as either:
 *   - 64-char hex string, or
 *   - base64 string that decodes to exactly 32 bytes.
 * Generate one with: `openssl rand -hex 32`.
 *
 * The key lives in env, NOT the DB. Compromising the DB alone must not
 * be enough to read secrets. If the env key is wrong/missing, the vault
 * fail-closes — every read/write throws, every settings endpoint returns
 * a clear "vault unavailable" error. We never silently downgrade to
 * plaintext storage.
 *
 * Format
 * ------
 * encryptedValue is base64(iv || authTag || ciphertext):
 *   - iv:        12 bytes (96-bit, GCM standard)
 *   - authTag:   16 bytes
 *   - ciphertext: variable
 *
 * Rotation
 * --------
 * v1 keeps one APP_ENCRYPTION_KEY. Rotation = decrypt with old, encrypt
 * with new, overwrite. We can add a key-version prefix later if we ever
 * need overlap during rotation. Out of scope today.
 *
 * Threat model
 * ------------
 * IN scope:
 *   - DB-only leak: backups, accidental git commit of dev.db, etc.
 *   - Casual inspection via `prisma studio`.
 *   - Tampering with ciphertext rows.
 *
 * OUT of scope (would require infrastructure we don't have):
 *   - Process memory dump while server is running.
 *   - Attacker who already has both DB and env.
 *   - Side-channel attacks on the host.
 */

import * as crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // 96 bits — recommended for GCM
const AUTH_TAG_LEN = 16;

let cachedKey: Buffer | null = null;
let cachedKeyError: string | null = null;

/**
 * Resolve APP_ENCRYPTION_KEY from env exactly once per process.
 * Throws `VaultUnavailableError` if the key is missing or malformed.
 * The error message intentionally does NOT include the env value.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (cachedKeyError) throw new VaultUnavailableError(cachedKeyError);

  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || raw.trim().length === 0) {
    cachedKeyError =
      "APP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` " +
      "and add it to .env before using server-side BYOK secrets.";
    throw new VaultUnavailableError(cachedKeyError);
  }

  let buf: Buffer | null = null;
  const trimmed = raw.trim();

  // Try hex first (64 chars). Then base64.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    try {
      buf = Buffer.from(trimmed, "hex");
    } catch {
      buf = null;
    }
  }
  if (!buf) {
    try {
      const decoded = Buffer.from(trimmed, "base64");
      // Buffer.from with "base64" silently truncates garbage — check length.
      if (decoded.length === 32) buf = decoded;
    } catch {
      buf = null;
    }
  }

  if (!buf || buf.length !== 32) {
    cachedKeyError =
      "APP_ENCRYPTION_KEY must decode to exactly 32 bytes (hex64 or base64-32B). " +
      "Generate one with `openssl rand -hex 32`.";
    throw new VaultUnavailableError(cachedKeyError);
  }

  cachedKey = buf;
  return cachedKey;
}

/** Throw when the vault key is missing or malformed. */
export class VaultUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultUnavailableError";
  }
}

/** Throw when a ciphertext won't decrypt (wrong key, tampered, corrupt). */
export class VaultDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultDecryptError";
  }
}

/**
 * Encrypt a plaintext secret. Returns base64(iv | tag | ciphertext).
 * Use a fresh random IV every time — never reuse with the same key.
 */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new TypeError("encryptSecret requires a non-empty string");
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Decrypt a previously encrypted value. Throws VaultDecryptError on any
 * corruption / wrong-key / tamper. Callers MUST treat this as a hard
 * failure and never fall back to assuming plaintext.
 */
export function decryptSecret(encoded: string): string {
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new VaultDecryptError("encrypted payload is empty");
  }
  const key = getKey();
  let buf: Buffer;
  try {
    buf = Buffer.from(encoded, "base64");
  } catch {
    throw new VaultDecryptError("encrypted payload is not valid base64");
  }
  if (buf.length < IV_LEN + AUTH_TAG_LEN + 1) {
    throw new VaultDecryptError("encrypted payload is too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    // Unified message — don't leak whether it was tag mismatch vs key
    // mismatch vs corruption.
    throw new VaultDecryptError("failed to decrypt secret");
  }
}

/**
 * Build a UI-safe redacted preview from a plaintext key.
 *
 * For typical provider keys this looks like:
 *   sk-proj-XXXXXX...abcd      (OpenAI project key)
 *   sk-ant-XXXXXX...abcd       (Anthropic)
 *   AIza...XXXX                (Gemini)
 *
 * Rules:
 *   - Preserve recognisable prefix (everything before/including the first '-'
 *     if length <= 8, otherwise first 4 chars).
 *   - Show literal ellipsis.
 *   - Reveal the last 4 chars.
 *   - For very short secrets (< 8 chars) reveal nothing — just '****'.
 */
export function buildRedactedPreview(plaintext: string): string {
  const s = plaintext.trim();
  if (s.length < 8) return "****";
  // Find prefix: keep up through first dash if it sits within the first
  // 12 chars, else first 4 chars.
  let prefix = s.slice(0, 4);
  const firstDash = s.indexOf("-");
  if (firstDash > 0 && firstDash <= 12) {
    prefix = s.slice(0, firstDash + 1);
  }
  const tail = s.slice(-4);
  return `${prefix}…${tail}`;
}

/**
 * Test helper — reset the cached key. Used only by unit tests that need
 * to swap APP_ENCRYPTION_KEY mid-test. Production code should never call
 * this.
 */
export function __resetVaultForTests(): void {
  cachedKey = null;
  cachedKeyError = null;
}

/**
 * Returns whether the vault is currently usable. Cheap — caches the
 * result. Routes can check this before offering BYOK forms so the user
 * gets a clear "vault unavailable, ask your admin" message instead of a
 * cryptic 500 on save.
 */
export function isVaultAvailable(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
