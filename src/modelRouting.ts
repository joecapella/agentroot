/**
 * Logical model routing for the CofounderAgent UI backend.
 *
 * Mirrors `src/CofounderAgent/model_routing.py`. Keep in sync when adding a
 * new TaskKind or logical model.
 *
 * Note (2026-05-12): `claude-opus-4-7` and `claude-sonnet-4-6` deployments
 * exist on the `plimsoll` Foundry account but currently return
 * `api_not_supported` on chat-completions endpoints. They are kept in
 * `ROUTES` for intent, but marked `unavailable: true` in
 * `LOGICAL_DEPLOYMENTS` so consumers fall back to a working model.
 */

export type TaskKind =
  | "deep_planning"
  | "general_chat"
  | "fast_brainstorm"
  | "code_repo"
  | "code_file"
  | "brand_strategy"
  | "copywriting"
  | "personal_ops"
  | "vision"
  | "visual";

export type Persona =
  | "orchestrator"
  | "code_assistant"
  | "brand_designer"
  | "ops"
  | "vision";

export type ReasoningProfile = "fast" | "balanced" | "deep";
export type ToolsMode = "off" | "ask" | "allowed";

export interface ModelRoute {
  defaultModel: string;
  fallback?: string;
  secondFallback?: string;
}

/** Premium-only routing — no gpt-4.1 defaults. */
export const ROUTES: Record<TaskKind, ModelRoute> = {
  deep_planning:   { defaultModel: "gpt-5.5",            fallback: "claude-opus-4-7",   secondFallback: "claude-sonnet-4-6" },
  general_chat:    { defaultModel: "gpt-5.5",            fallback: "claude-sonnet-4-6", secondFallback: "deepseek-v4-flash" },
  fast_brainstorm: { defaultModel: "deepseek-v4-flash",  fallback: "claude-sonnet-4-6", secondFallback: "gpt-5.5" },
  code_repo:       { defaultModel: "claude-opus-4-7",    fallback: "gpt-5.5",           secondFallback: "claude-sonnet-4-6" },
  code_file:       { defaultModel: "claude-sonnet-4-6",  fallback: "claude-opus-4-7",   secondFallback: "gpt-5.5" },
  brand_strategy:  { defaultModel: "claude-opus-4-7",    fallback: "gpt-5.5",           secondFallback: "claude-sonnet-4-6" },
  copywriting:     { defaultModel: "claude-sonnet-4-6",  fallback: "claude-opus-4-7",   secondFallback: "gpt-5.5" },
  personal_ops:    { defaultModel: "claude-opus-4-7",    fallback: "gpt-5.5",           secondFallback: "claude-sonnet-4-6" },
  vision:          { defaultModel: "kimi-k2.6",          fallback: "gpt-5.5" },
  visual:          { defaultModel: "gpt-image-2" },
};

export interface DeploymentSpec {
  deployment: string;
  family:
    | "azure_openai"
    | "image_gen"
    | "direct_openai"
    | "direct_anthropic";
  unavailable?: boolean;
  useMaxCompletionTokens?: boolean;
  /** Env var holding the base endpoint URL (e.g. GEMINI_ENDPOINT). */
  endpointEnvVar?: string;
  /** Env var holding the API key (e.g. GEMINI_API_KEY). */
  apiKeyEnvVar?: string;
  /**
   * Hardcoded base endpoint URL. Used for public providers where the
   * URL is invariant (e.g. https://api.openai.com/v1) so signed-in users
   * only need to supply a key, not also an endpoint.
   */
  baseUrl?: string;
  /**
   * Which BYOK key (from the per-request user-keys object) to use as the
   * bearer for this deployment. If unset, falls back to `apiKeyEnvVar`.
   */
  userKeyName?: "openai" | "anthropic" | "gemini";
}

export const LOGICAL_DEPLOYMENTS: Record<string, DeploymentSpec> = {
  "gpt-5.5":           { deployment: "gpt-5.5",            family: "azure_openai", useMaxCompletionTokens: true },
  "gpt-4.1":           { deployment: "gpt-4.1",            family: "azure_openai" },
  "claude-opus-4-7":   { deployment: "claude-opus-4-7",    family: "azure_openai", unavailable: true },
  "claude-sonnet-4-6": { deployment: "claude-sonnet-4-6",  family: "azure_openai", unavailable: true },
  "deepseek-v4-flash": { deployment: "DeepSeek-V4-Flash",  family: "azure_openai" },
  "kimi-k2.6":         { deployment: "Kimi-K2.6",          family: "azure_openai" },
  "gpt-image-2":       { deployment: "gpt-image-2-1",      family: "image_gen" },
  // Example direct provider configs — set env vars to enable
  "gemini-pro":        { deployment: "gemini-2.5-pro-preview-03-25", family: "direct_openai", endpointEnvVar: "GEMINI_ENDPOINT", apiKeyEnvVar: "GEMINI_API_KEY" },
  "gemini-flash":      { deployment: "gemini-2.5-flash-preview-04-17", family: "direct_openai", endpointEnvVar: "GEMINI_ENDPOINT", apiKeyEnvVar: "GEMINI_API_KEY" },
  "ollama-coder":      { deployment: "qwen2.5-coder:7b", family: "direct_openai", endpointEnvVar: "OLLAMA_ENDPOINT" },
  "ollama-fast":       { deployment: "llama3.2:3b", family: "direct_openai", endpointEnvVar: "OLLAMA_ENDPOINT" },
  "ollama-deep":       { deployment: "qwen2.5-coder:14b", family: "direct_openai", endpointEnvVar: "OLLAMA_ENDPOINT" },

  // BYOK ("Bring Your Own Key") deployments. Routed when the user has
  // pasted their own provider API key into the Settings panel. Keys live
  // only in the browser's localStorage and are sent per-request — we
  // never persist them server-side.
  "byok-openai-chat":  {
    deployment: "gpt-4o",
    family: "direct_openai",
    baseUrl: "https://api.openai.com/v1",
    userKeyName: "openai",
  },
  "byok-openai-mini":  {
    deployment: "gpt-4o-mini",
    family: "direct_openai",
    baseUrl: "https://api.openai.com/v1",
    userKeyName: "openai",
  },
  "byok-openai-image": {
    deployment: "gpt-image-1",
    family: "image_gen",
    baseUrl: "https://api.openai.com/v1",
    userKeyName: "openai",
  },
  "byok-anthropic":    {
    deployment: "claude-3-5-sonnet-20241022",
    family: "direct_anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    userKeyName: "anthropic",
  },
  "byok-gemini":       {
    deployment: "gemini-2.0-flash-exp",
    family: "direct_openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    userKeyName: "gemini",
  },
};

/**
 * The userKeys object that flows through a single chat request. Only
 * lives in memory for the duration of the request — never persisted.
 */
export interface UserKeys {
  openai?: string;
  anthropic?: string;
  gemini?: string;
}

/**
 * Pick the BYOK chat deployment for the keys the user has supplied.
 * Order: OpenAI > Anthropic > Gemini. Returns null when the user has not
 * supplied any keys, in which case the caller falls back to the default
 * Foundry routing (Joseph's self-hosted setup).
 */
export function pickByokChatModel(
  keys: UserKeys | undefined | null,
  task: TaskKind,
): DeploymentSpec | null {
  if (!keys) return null;
  if (keys.openai && keys.openai.trim()) {
    if (task === "fast_brainstorm") {
      return LOGICAL_DEPLOYMENTS["byok-openai-mini"];
    }
    return LOGICAL_DEPLOYMENTS["byok-openai-chat"];
  }
  if (keys.anthropic && keys.anthropic.trim()) {
    return LOGICAL_DEPLOYMENTS["byok-anthropic"];
  }
  if (keys.gemini && keys.gemini.trim()) {
    return LOGICAL_DEPLOYMENTS["byok-gemini"];
  }
  return null;
}

/**
 * Pick the BYOK image deployment for the keys the user has supplied.
 * Currently only OpenAI's gpt-image-1 is supported (Anthropic has no
 * image gen; Gemini's image surface is different).
 */
export function pickByokImageModel(
  keys: UserKeys | undefined | null,
): DeploymentSpec | null {
  if (!keys) return null;
  if (keys.openai && keys.openai.trim()) {
    return LOGICAL_DEPLOYMENTS["byok-openai-image"];
  }
  return null;
}

export const PERSONA_TO_TASK: Record<Persona, TaskKind> = {
  orchestrator:   "general_chat",
  code_assistant: "code_file",
  brand_designer: "brand_strategy",
  ops:            "personal_ops",
  vision:         "vision",
};

/** Safety net when the whole route is unavailable. */
export const LAST_RESORT_LOGICAL =
  process.env.LAST_RESORT_LOGICAL ?? "gpt-5.5";

export function pickModelForTask(task: TaskKind): ModelRoute {
  return ROUTES[task];
}

/**
 * Pick the logical model name that will actually be used for CHAT for this
 * task. Skips fallbacks whose deployment family isn't chat-capable
 * (`image_gen` etc.) because the container's `_make_chat_llm` cannot build
 * a chat client for them (Bug-7/9). Returns the first chat-capable
 * available deployment, or last-resort.
 */
export function pickChatModelForTask(task: TaskKind): DeploymentSpec {
  const route = ROUTES[task];
  for (const logical of [route.defaultModel, route.fallback, route.secondFallback]) {
    if (!logical) continue;
    const spec = resolveAvailable(logical);
    if (spec && (spec.family === "azure_openai" || spec.family === "direct_openai")) return spec;
  }
  const last = resolveAvailable(LAST_RESORT_LOGICAL);
  if (!last || last.family !== "azure_openai") {
    throw new Error(
      `No available CHAT deployment for task ${task}; last-resort ${LAST_RESORT_LOGICAL} also unavailable or non-chat. Check LOGICAL_DEPLOYMENTS.`
    );
  }
  return last;
}

export function deploymentForModel(logical: string, fallback = "gpt-5.5"): string {
  const key = "MODEL_DEPLOYMENT_" + logical.replace(/[^a-zA-Z0-9]/g, "_");
  const envVal = process.env[key];
  if (envVal) return envVal;
  return LOGICAL_DEPLOYMENTS[logical]?.deployment ?? fallback;
}

export function resolveAvailable(logical: string): DeploymentSpec | null {
  const spec = LOGICAL_DEPLOYMENTS[logical];
  if (!spec || spec.unavailable) return null;
  return spec;
}

export function resolveRouteForTask(task: TaskKind): DeploymentSpec {
  const route = ROUTES[task];
  for (const logical of [route.defaultModel, route.fallback, route.secondFallback]) {
    if (!logical) continue;
    const spec = resolveAvailable(logical);
    if (spec) return spec;
  }
  const last = resolveAvailable(LAST_RESORT_LOGICAL);
  if (!last) {
    throw new Error(
      `No available chat deployment for task ${task}; last-resort ${LAST_RESORT_LOGICAL} also unavailable. Check LOGICAL_DEPLOYMENTS.`
    );
  }
  return last;
}

/**
 * Resolve a route with user-defined overrides. Overrides are stored in
 * UserProfile.preferencesJson and applied server-side. If the user has
 * overridden a task kind to a specific logical model, we use that model
 * directly (skipping the hardcoded route chain). Otherwise we fall back
 * to the normal `resolveRouteForTask` behavior.
 */
export function resolveRouteForTaskWithOverrides(
  task: TaskKind,
  overrides?: Record<string, string | null>
): DeploymentSpec {
  if (overrides && overrides[task]) {
    const logical = overrides[task];
    if (logical) {
      const spec = resolveAvailable(logical);
      if (spec) return spec;
    }
  }
  return resolveRouteForTask(task);
}

/**
 * Pick the chat model for a task, respecting user overrides.
 * This is the drop-in replacement for `pickChatModelForTask` when
 * the caller has access to the user's profile preferences.
 */
export function pickChatModelForTaskWithOverrides(
  task: TaskKind,
  overrides?: Record<string, string | null>
): DeploymentSpec {
  // If user has overridden this task, try their choice first, then fall
  // through the normal chain.
  if (overrides && overrides[task]) {
    const logical = overrides[task];
    if (logical) {
      const spec = resolveAvailable(logical);
      if (spec && (spec.family === "azure_openai" || spec.family === "direct_openai")) {
        return spec;
      }
    }
  }
  return pickChatModelForTask(task);
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

/**
 * Explicit image-generation prompts. Kept as a module-level regex so it
 * can be checked BEFORE the persona shortcut — the user can pick the
 * `vision` or `brand_designer` persona and still say "generate me an
 * image of X", and we want that to actually generate an image rather
 * than be hijacked into a text-only critique by the persona's default
 * TaskKind.
 *
 * The regex requires both a creation verb AND a visual-medium noun so it
 * doesn't fire on prose like "make a sketch of the plan" (sketch is also
 * "a draft" in English).
 */
const VISUAL_GENERATION_RE =
  /\b(generate|create|draw|make|design|render|produce)\s+(a|an|the|me|us|you)?\s*(hero\s+image|image|illustration|wallpaper|thumbnail|mockup|logo|poster|banner|icon|picture|photo|sketch|painting|drawing|render|artwork)\b/;
const VISUAL_NOUN_BIGRAM_RE =
  /\b(hero image|product mockup|brand mockup|book cover|album cover|cover art|key art)\b/;

export function inferTaskKind(
  message: string,
  opts: { reasoning?: ReasoningProfile; persona?: Persona } = {}
): TaskKind {
  const { reasoning = "balanced", persona } = opts;
  const lower = message.toLowerCase();

  // Explicit image-generation requests ALWAYS win over the persona default.
  // Previously this lived below the persona shortcut, so picking the
  // `vision` persona and saying "generate an image of X" routed to
  // image-understanding (Kimi-K2.6) and returned a written brief instead
  // of a rendered image.
  if (VISUAL_GENERATION_RE.test(lower) || VISUAL_NOUN_BIGRAM_RE.test(lower)) {
    return "visual";
  }

  if (persona) return PERSONA_TO_TASK[persona];

  // Vision: image understanding (caption, OCR, "what's in this picture").
  if (
    /\b(screenshot|what is in this image|what do you see|read this image|ocr|caption (this|the) image|describe (this|the) image)\b/.test(
      lower
    )
  ) {
    return "vision";
  }
  // Code: require multi-word context or unambiguous identifiers. The old
  // single-word matches on "component" / "hook" / "render" routed natural
  // English to the code persona — Bug-7.
  if (
    /\b(refactor|stack trace|tsconfig|next\.js|prisma|bicep|typescript)\b/.test(lower) ||
    /\b(react|vue|svelte) (component|hook)\b/.test(lower) ||
    /\b(sql query|sql schema|database migration)\b/.test(lower) ||
    /\b(fix (a |the )?bug|fix (this|the) (bug|crash|error)|debug (this|the))\b/.test(lower)
  ) {
    return reasoning === "deep" ? "code_repo" : "code_file";
  }
  if (/\b(tagline|positioning|brand|naming|landing page|copy|headline|messaging)\b/.test(lower)) {
    return "brand_strategy";
  }
  if (/\b(plan|prioritize|priorit(y|ies)|next steps?|todo|schedule|block|week)\b/.test(lower)) {
    return reasoning === "deep" ? "deep_planning" : "personal_ops";
  }
  if (reasoning === "deep") return "deep_planning";
  if (reasoning === "fast") return "fast_brainstorm";
  return "general_chat";
}

export function personaForTask(task: TaskKind): Persona {
  switch (task) {
    case "code_file":
    case "code_repo":
      return "code_assistant";
    case "brand_strategy":
    case "copywriting":
      return "brand_designer";
    case "personal_ops":
    case "deep_planning":
      return "ops";
    case "vision":
      return "vision";
    case "visual":
      return "brand_designer";
    case "general_chat":
    case "fast_brainstorm":
    default:
      return "orchestrator";
  }
}
