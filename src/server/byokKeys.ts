/**
 * BYOK key resolver — server-side decrypt-on-use for stored UserSecret rows.
 *
 * Why server-side
 * ---------------
 * Previously /api/chat accepted `userKeys` in the request body, which meant
 * the browser had to remember and resend the key on every turn. That's:
 *   - one extra plaintext copy per request (browser localStorage)
 *   - vulnerable to any XSS that reads localStorage
 *   - impossible to rotate without the user re-pasting
 *
 * Now the canonical store is the UserSecret table. Plaintext is recovered
 * only at the moment of use, only in the request handler, and only for
 * the userId that owns the row.
 *
 * Cache
 * -----
 * Decrypt is fast (~microseconds) but we still cache the resolved keys per
 * userId for the duration of a single request via the returned object —
 * callers should call resolveUserKeys() ONCE per request and pass the
 * result to downstream functions.
 *
 * Failure mode
 * ------------
 * If the vault is unavailable or a row's ciphertext fails to decrypt,
 * the function logs (without the secret) and OMITS that provider from
 * the returned object. Caller sees "key missing" semantics rather than
 * a 500 — degraded mode is better than total outage.
 */

import { prisma } from "@/src/prisma";
import { decryptSecret, isVaultAvailable, VaultDecryptError } from "@/src/server/secretsVault";
import type { UserKeys } from "@/src/modelRouting";

// Mapping table — UserSecret.provider → UserKeys field name.
// Add new providers here when modelRouting also learns about them.
const PROVIDER_TO_FIELD: Record<string, keyof UserKeys> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
};

/**
 * Read the user's BYOK keys from the encrypted store and return them in
 * the shape modelRouting expects. Safe to call when no keys exist (returns
 * an empty object).
 */
export async function resolveUserKeys(userId: string): Promise<UserKeys> {
  if (!isVaultAvailable()) {
    // No vault → no BYOK. This is not an error; the user may not have
    // configured BYOK and the request will fall through to default routing.
    return {};
  }

  const rows = await prisma.userSecret.findMany({
    where: { userId, label: "default" },
    select: { provider: true, encryptedValue: true },
  });

  const out: UserKeys = {};
  for (const row of rows) {
    const field = PROVIDER_TO_FIELD[row.provider];
    if (!field) continue; // unknown provider — don't risk misrouting
    try {
      const plain = decryptSecret(row.encryptedValue);
      out[field] = plain;
    } catch (err) {
      // Decrypt failure means tampered row OR key rotated without
      // re-encryption. Log the provider (NEVER the ciphertext or plaintext)
      // and skip — the request continues without this BYOK key.
      if (err instanceof VaultDecryptError) {
        console.warn(
          "[byok] decrypt failed user=%s provider=%s — row will be ignored",
          userId,
          row.provider,
        );
      } else {
        console.warn(
          "[byok] unexpected error user=%s provider=%s",
          userId,
          row.provider,
        );
      }
      continue;
    }
  }
  return out;
}

/**
 * Test helper — replace the live resolver with a static map. Returns a
 * disposer that restores the original. Used by tests that need to drive
 * the chat path without touching the real DB.
 */
let testOverride: ((userId: string) => Promise<UserKeys>) | null = null;
export function __setResolverForTests(fn: ((userId: string) => Promise<UserKeys>) | null): void {
  testOverride = fn;
}

/**
 * Wrapper used by route handlers so tests can swap behaviour without
 * monkey-patching. Production callers can use either name.
 */
export async function getEffectiveUserKeys(userId: string): Promise<UserKeys> {
  if (testOverride) return testOverride(userId);
  return resolveUserKeys(userId);
}
