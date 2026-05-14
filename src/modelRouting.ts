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
  family: "azure_openai" | "image_gen";
  unavailable?: boolean;
  useMaxCompletionTokens?: boolean;
}

export const LOGICAL_DEPLOYMENTS: Record<string, DeploymentSpec> = {
  "gpt-5.5":           { deployment: "gpt-5.5",            family: "azure_openai", useMaxCompletionTokens: true },
  "gpt-4.1":           { deployment: "gpt-4.1",            family: "azure_openai" },
  "claude-opus-4-7":   { deployment: "claude-opus-4-7",    family: "azure_openai", unavailable: true },
  "claude-sonnet-4-6": { deployment: "claude-sonnet-4-6",  family: "azure_openai", unavailable: true },
  "deepseek-v4-flash": { deployment: "DeepSeek-V4-Flash",  family: "azure_openai" },
  "kimi-k2.6":         { deployment: "Kimi-K2.6",          family: "azure_openai" },
  "gpt-image-2":       { deployment: "gpt-image-2-1",      family: "image_gen" },
};

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
    if (spec && spec.family === "azure_openai") return spec;
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

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

export function inferTaskKind(
  message: string,
  opts: { reasoning?: ReasoningProfile; persona?: Persona } = {}
): TaskKind {
  const { reasoning = "balanced", persona } = opts;
  const lower = message.toLowerCase();

  if (persona) return PERSONA_TO_TASK[persona];

  // Visual: require an explicit image-generation verb/phrase. Past versions
  // matched bare "render" which fires on phrases like "render my opinion" —
  // Bug-7. We now require either an explicit "generate/create/draw an image"
  // phrase or a clearly visual noun bigram.
  if (
    /\b(generate|create|draw|make|design)\s+(a|an|the)?\s*(hero\s+image|image|illustration|wallpaper|thumbnail|mockup|logo|poster|banner|icon)\b/.test(
      lower
    ) ||
    /\b(hero image|product mockup|brand mockup|book cover|album cover)\b/.test(lower)
  ) {
    return "visual";
  }
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
