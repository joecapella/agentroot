/**
 * Persona prompt loader.
 *
 * The deployed Foundry container has its own baked persona prompts
 * (src/CofounderAgent/prompts/*.prompt.md), but those only update when
 * the container is rebuilt + redeployed via `azd up`. That's slow.
 *
 * To allow Joseph to hot-edit a persona prompt in `agent-config/` and
 * see the change on the next message, we read the file body at request
 * time and smuggle it into the user input as a `[SYSTEM_OVERRIDE]`
 * block. Microsoft Foundry hosted agents reject the Responses
 * `instructions` field (HTTP 400 `invalid_payload` / `param:
 * instructions`), so the override has to ride along inside the user
 * channel.
 *
 * If the file is missing or unreadable for any reason, we fall back
 * to nothing and let the container's baked prompt drive the turn —
 * never crash the chat request because of a prompt-loader issue.
 *
 * Note on Next 15 build: all `node:fs` access is kept inside the
 * function bodies so Next's "Collecting page data" phase does not
 * eagerly evaluate fs/path at module load, which is what breaks the
 * `pages-manifest.json` step when a server-only module is imported
 * by a route.
 */

import type { Persona } from "@/src/modelRouting";

const PERSONA_TO_FILE: Record<Persona, string> = {
  orchestrator: "orchestrator.prompt.md",
  code_assistant: "code-assistant.prompt.md",
  brand_designer: "brand-designer.prompt.md",
  ops: "ops-agent.prompt.md",
  vision: "vision-agent.prompt.md",
};

interface CacheEntry {
  mtimeMs: number;
  content: string;
}

const cache = new Map<string, CacheEntry>();

/**
 * Load the persona prompt body from `agent-config/<persona>.prompt.md`.
 * Returns `null` if the file is missing / unreadable. Cached per-file
 * with an mtime check, so editing the prompt does not require a server
 * restart but unchanged files are not re-read on every turn.
 */
export function loadPersonaPrompt(persona: Persona): string | null {
  try {
    // Lazy require so module load is side-effect-free and Next 15's
    // page-data collection phase does not eagerly bind node:fs into a
    // server-or-client bundle decision (the eager binding is what breaks
    // the pages-manifest.json build step on this project).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { existsSync, readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join, resolve } = require("node:path") as typeof import("node:path");

    const fname = PERSONA_TO_FILE[persona];
    if (!fname) return null;
    const root = process.env.REPO_ROOT ?? process.cwd();
    const full = join(resolve(root, "agent-config"), fname);
    if (!existsSync(full)) return null;
    const st = statSync(full);
    const hit = cache.get(full);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.content;
    const content = readFileSync(full, "utf-8");
    cache.set(full, { mtimeMs: st.mtimeMs, content });
    return content;
  } catch (err) {
    console.warn("[personaPrompts] load failed:", err);
    return null;
  }
}

/**
 * Compose the full system-override payload for a turn.
 *
 * Order: persona prompt body, then the memory preamble (facts +
 * extraction guide). Both are optional. Returns `undefined` if there
 * is nothing to send so the route can skip the override entirely.
 */
export function composeInstructions(
  persona: Persona,
  memoryPreamble?: string | null,
): string | undefined {
  const body = loadPersonaPrompt(persona);
  const parts: string[] = [];
  if (body && body.trim()) parts.push(body.trim());
  if (memoryPreamble && memoryPreamble.trim()) parts.push(memoryPreamble.trim());
  if (parts.length === 0) return undefined;
  return parts.join("\n\n---\n\n");
}

/** Test-only: clear the in-memory cache. */
export function __resetPersonaPromptCache(): void {
  cache.clear();
}
