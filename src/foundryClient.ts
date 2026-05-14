/**
 * Foundry hosted-agent client.
 *
 * Talks to Microsoft Foundry hosted agents over the OpenAI-compatible
 * Responses protocol. We deliberately avoid `@azure/ai-projects` for v1 — the
 * SDK's threads/runs surface doesn't match hosted agents 1:1, and a thin fetch
 * client is easier to reason about for security review.
 *
 * Auth: DefaultAzureCredential. In WSL dev this picks up `az login`; in a
 * deployed Node host you'd use a managed identity scoped to the AI account.
 *
 * Security notes:
 * - Token audience MUST be `https://ai.azure.com` (validated 2026-05-12).
 * - We cache the bearer token until ~2 minutes before expiry.
 * - We never log the token. We DO log status codes and request ids.
 */

import { DefaultAzureCredential, type AccessToken } from "@azure/identity";

const AGENT_API_VERSION = "2025-11-15-preview";
const TOKEN_AUDIENCE = "https://ai.azure.com/.default";
const AZURE_OPENAI_TOKEN_AUDIENCE = "https://cognitiveservices.azure.com/.default";
const TOKEN_REFRESH_SAFETY_MS = 2 * 60 * 1000;
/** Default upstream timeout. Long enough for deep_planning + tool loops,
 *  short enough that a hung Foundry doesn't lock up /api/chat forever. */
const DEFAULT_INVOKE_TIMEOUT_MS = 60_000;
/** Image generation can legitimately take longer than chat, especially for
 *  1024x1536/high quality. Keep it bounded so /api/chat can surface a clear
 *  error instead of appearing to hang forever. */
const DEFAULT_IMAGE_TIMEOUT_MS = 180_000;

/**
 * Recognise a valid Responses-protocol response id.
 *
 * Foundry hosted agents emit ids prefixed with `caresp_` (chat agent
 * response). `resp_` is the upstream OpenAI prefix and is accepted too in
 * case the surface ever normalises. Anything else — most importantly Foundry
 * `agent_session_id` (a bare hex string) — is rejected as a chain target
 * because passing it as `previous_response_id` produces HTTP 500 (root cause
 * documented 2026-05-12). */
const RESPONSE_ID_RE = /^(caresp_|resp_)[A-Za-z0-9_-]+$/;

export function isValidResponseId(id: string | undefined | null): id is string {
  return typeof id === "string" && RESPONSE_ID_RE.test(id);
}

/** Compose multiple AbortSignals into a single one that aborts when any does.
 *  Node 20+ has `AbortSignal.any` but we keep a manual fallback for older
 *  runtimes / unusual hosting. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builtin = (AbortSignal as any).any as
    | ((signals: AbortSignal[]) => AbortSignal)
    | undefined;
  if (typeof builtin === "function") return builtin(signals);
  const ctl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctl.abort(s.reason), { once: true });
  }
  return ctl.signal;
}

let _credential: DefaultAzureCredential | null = null;
const _cachedTokens = new Map<string, AccessToken>();

function credential(): DefaultAzureCredential {
  if (!_credential) _credential = new DefaultAzureCredential();
  return _credential;
}

async function getBearer(audience = TOKEN_AUDIENCE): Promise<string> {
  const now = Date.now();
  const cached = _cachedTokens.get(audience);
  if (cached && cached.expiresOnTimestamp - now > TOKEN_REFRESH_SAFETY_MS) {
    return cached.token;
  }
  const tok = await credential().getToken(audience);
  if (!tok) throw new Error(`Failed to acquire Azure AD token for ${audience}`);
  _cachedTokens.set(audience, tok);
  return tok.token;
}

/**
 * Test-only hook: inject a synthetic bearer token so unit tests don't need
 * `az login` or a live Azure identity. Pass `null` to clear. The cache is
 * also seeded for the full TOKEN_REFRESH_SAFETY_MS window so getBearer never
 * touches DefaultAzureCredential during the test run.
 *
 * Not exposed in any production code path; only test files reach for it.
 */
export function __setTestToken(token: string | null): void {
  _cachedTokens.clear();
  if (token === null) return;
  const cached = {
    token,
    expiresOnTimestamp: Date.now() + 60 * 60 * 1000,
  } as AccessToken;
  _cachedTokens.set(TOKEN_AUDIENCE, cached);
  _cachedTokens.set(AZURE_OPENAI_TOKEN_AUDIENCE, cached);
}

export function projectEndpoint(): string {
  const url = process.env.AZURE_AI_PROJECT_ENDPOINT;
  if (!url) throw new Error("AZURE_AI_PROJECT_ENDPOINT not set in environment");
  return url.replace(/\/$/, "");
}

/** Build the responses endpoint URL for a given agent name. */
export function responsesEndpointFor(agentName: string): string {
  return (
    `${projectEndpoint()}/agents/${encodeURIComponent(agentName)}` +
    `/endpoint/protocols/openai/responses?api-version=${AGENT_API_VERSION}`
  );
}

/**
 * Some deployments configure `AGENT_*_RESPONSES_ENDPOINT` directly (the
 * full URL Foundry prints for the agent). When that env var exists, we
 * prefer it verbatim — but we MUST verify its `/agents/<segment>/` path
 * segment matches `agentName`. Drift between `COFOUNDER_AGENT_NAME` and the
 * suffix inside `AGENT_*_RESPONSES_ENDPOINT` was the root cause of the
 * 2026-05-12 production 502 ("foundry_invoke_failed"). Catching it at first
 * call turns a runtime upstream 404 into a clear config error.
 *
 * Returns the URL to use, or throws with a stable code on mismatch.
 */
export function resolveEndpoint(agentName: string): string {
  const envKey =
    "AGENT_" + agentName.toUpperCase().replace(/[^A-Z0-9]/g, "") + "_RESPONSES_ENDPOINT";
  const direct = process.env[envKey];
  if (!direct) return responsesEndpointFor(agentName);

  let parsed: URL;
  try {
    parsed = new URL(direct);
  } catch {
    throw new Error(`agent_endpoint_invalid_url: ${envKey} is not a valid URL`);
  }
  // Extract `/agents/<segment>/` segment.
  const m = parsed.pathname.match(/\/agents\/([^/]+)\//);
  if (!m) {
    throw new Error(
      `agent_endpoint_no_agents_segment: ${envKey} has no /agents/<name>/ path`
    );
  }
  const declared = decodeURIComponent(m[1]);
  if (declared !== agentName) {
    throw new Error(
      `agent_endpoint_name_mismatch: ${envKey} targets /agents/${declared}/ ` +
        `but COFOUNDER_AGENT_NAME is "${agentName}". Fix one to match the other.`
    );
  }
  return direct;
}

// ---------------------------------------------------------------------------
// Responses-protocol payload shape (subset we use).
// ---------------------------------------------------------------------------

/**
 * OpenAI-compatible function-tool descriptor as accepted by the Responses
 * protocol. Note: Responses uses a flat shape (`type:"function"`, plus name /
 * description / parameters at the top level), NOT the older Chat Completions
 * wrapper (`{ type:"function", function: { ... } }`).
 */
export interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    [k: string]: unknown;
  };
  /** Optional strict-mode marker accepted by recent Responses surfaces. */
  strict?: boolean;
}

export interface ResponsesRequest {
  /** Agent name to invoke (acts as the "model" in OpenAI parlance). */
  model: string;
  /**
   * User input. Either a plain string (single-turn) or an array of
   * role-tagged content parts (multi-turn).
   *
   * IMPORTANT: the Responses protocol only accepts `user`, `assistant`, and
   * `developer` as top-level input roles. `system` is NOT accepted here —
   * sending `role: "system"` produces HTTP 400 from Foundry. Put system-level
   * guidance in the top-level `instructions` field instead, or rely on the
   * agent's own baked-in system prompt (which the CofounderAgent container
   * already does via `SystemMessage`).
   */
  input:
    | string
    | Array<
        | {
            role: "user" | "assistant" | "developer";
            content:
              | string
              | Array<
                  | { type: "input_text"; text: string }
                  | { type: "input_image"; image_url: { url: string } }
                >;
          }
        | { type: "function_call_output"; call_id: string; output: string }
      >;
  /**
   * Optional system-style guidance attached to this turn. Use this instead
   * of a `role: "system"` input entry.
   */
  instructions?: string;
  /**
   * The `id` of a prior Responses envelope (e.g. "caresp_..."), used to chain
   * a multi-turn response. This is NOT a Foundry `session_id` or
   * `agent_session_id` — passing one of those here causes HTTP 500 upstream.
   * Note: chaining via `previous_response_id` alone does NOT forward prior
   * message content to the hosted LangGraph agent; use the `input` array form
   * with role-tagged messages if you need true conversational memory.
   */
  previous_response_id?: string;
  /**
   * OpenAI-compatible tool list for Responses-compatible providers.
   *
   * Do NOT send this to Microsoft Foundry hosted-agent endpoints by default:
   * the hosted-agent Responses surface currently rejects top-level `tools`
   * with HTTP 400 `invalid_payload` / `param: tools`. CofounderAgent tools are
   * registered inside the container via LangChain `bind_tools(TOOLS)` instead.
   */
  tools?: ResponsesFunctionTool[];
  /** Standard OpenAI tool_choice: "auto" | "none" | "required" | {type,name}. */
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; name: string };
  /** Streaming hint (forwarded as-is; we don't parse SSE yet). */
  stream?: boolean;
  /** Pass-through additional fields if needed. */
  [key: string]: unknown;
}

export interface ResponsesError {
  code: string;
  message: string;
}

export interface ResponsesOutputText {
  type: "output_text";
  text: string;
  annotations?: unknown[];
}

export interface ResponsesOutputMessage {
  type: "message";
  id: string;
  role: "assistant";
  status: "completed" | "in_progress" | "failed";
  content: ResponsesOutputText[];
}

export interface ResponsesFunctionCall {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status: "completed" | "in_progress" | "failed";
}

export interface ResponsesFunctionOutput {
  type: "function_call_output";
  id: string;
  call_id: string;
  output: string;
}

export interface ResponsesImageGenerationCall {
  type: "image_generation_call";
  id: string;
  status: "completed" | "in_progress" | "failed";
  /** Base64-encoded image content. */
  result?: string;
}

export type ResponsesOutputItem =
  | ResponsesOutputMessage
  | ResponsesFunctionCall
  | ResponsesFunctionOutput
  | ResponsesImageGenerationCall
  | { type: string; [k: string]: unknown };

/**
 * Token usage reported by the Responses surface. Field names follow the
 * OpenAI Responses convention (`input_tokens` / `output_tokens`), not the
 * older Chat Completions convention (`prompt_tokens` / `completion_tokens`).
 * Some upstreams still emit the older names — `extractUsage()` normalises.
 */
export interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  /** Legacy / chat-completions style — accepted as fallback. */
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface ResponsesEnvelope {
  id: string;
  object: "response";
  status: "completed" | "in_progress" | "failed";
  error: ResponsesError | null;
  output: ResponsesOutputItem[];
  agent?: { type: string; name: string; version: string };
  agent_session_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
  /** Token accounting — present on most successful envelopes. */
  usage?: ResponsesUsage;
}

/**
 * Normalised token usage. Returns zeros when the envelope omits usage.
 * Falls back to chat-completions-style field names so we work uniformly
 * across Foundry hosted agents and direct OpenAI-compat providers.
 */
export function extractUsage(env: ResponsesEnvelope): {
  promptTokens: number;
  completionTokens: number;
} {
  const u = env.usage;
  if (!u) return { promptTokens: 0, completionTokens: 0 };
  const promptTokens = u.input_tokens ?? u.prompt_tokens ?? 0;
  const completionTokens = u.output_tokens ?? u.completion_tokens ?? 0;
  return { promptTokens, completionTokens };
}

// ---------------------------------------------------------------------------
// Invocation
// ---------------------------------------------------------------------------

export interface InvokeError extends Error {
  status?: number;
  requestId?: string;
  body?: unknown;
}

/**
 * Invoke a hosted agent. Returns the parsed envelope on HTTP 200, throws on
 * transport-level errors. Note that a 200 with `status === "failed"` is a
 * *logical* error reported by the agent — the caller decides how to surface
 * it.
 */
/**
 * Invoke with retry on transient gateway errors (502/503/504).
 */
export async function invokeAgentWithRetry(
  agentName: string,
  payload: Omit<ResponsesRequest, "model">,
  opts: {
    maxRetries?: number;
    baseDelayMs?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
    attachTools?: boolean;
    tools?: ResponsesFunctionTool[];
  } = {}
): Promise<ResponsesEnvelope> {
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  let lastErr: InvokeError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await invokeAgent(agentName, payload, opts);
    } catch (err) {
      lastErr = err as InvokeError;
      const status = lastErr.status ?? 0;
      if (status < 502 || status > 504) throw lastErr;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr!;
}

export interface InvokeAgentOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * Whether callers want tools available to the model. For Foundry hosted
   * agents this is satisfied by the container's LangChain `bind_tools(TOOLS)`.
   *
   * IMPORTANT: as of 2026-05-14, the hosted-agent Responses endpoint rejects
   * a top-level `tools` field with HTTP 400 `invalid_payload` / `param: tools`.
   * Do not serialize this option into the Foundry request body unless the
   * platform adds support and `FOUNDRY_RESPONSES_ALLOW_TOOLS=true` is set.
   */
  attachTools?: boolean;
  /**
   * Future escape hatch for raw Responses tool descriptors. Ignored by
   * default for Foundry hosted agents for the same reason as `attachTools`.
   */
  tools?: ResponsesFunctionTool[];
}

export async function invokeAgent(
  agentName: string,
  payload: Omit<ResponsesRequest, "model">,
  opts: InvokeAgentOptions = {}
): Promise<ResponsesEnvelope> {
  const url = resolveEndpoint(agentName);
  const token = await getBearer();
  const allowTopLevelTools = process.env.FOUNDRY_RESPONSES_ALLOW_TOOLS === "true";
  const requestedTools = opts.tools ?? (payload.tools as ResponsesFunctionTool[] | undefined);
  const body: ResponsesRequest = {
    model: agentName,
    ...payload,
    // Foundry hosted agents currently reject top-level `tools`. The deployed
    // CofounderAgent already binds the same tools inside the container, which
    // is the supported path for hosted-agent tool calls today.
    ...(allowTopLevelTools && requestedTools && requestedTools.length > 0
      ? { tools: requestedTools, tool_choice: payload.tool_choice ?? "auto" }
      : {}),
  } as ResponsesRequest;

  // Compose caller's AbortSignal with our own timeout signal so a hung
  // upstream cannot block /api/chat indefinitely.
  const timeoutMs = opts.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
  const timeoutCtl = new AbortController();
  const timer = setTimeout(() => timeoutCtl.abort(), timeoutMs);
  const signal = opts.signal
    ? anySignal([opts.signal, timeoutCtl.signal])
    : timeoutCtl.signal;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (timeoutCtl.signal.aborted) {
      const e: InvokeError = new Error(
        `Foundry invokeAgent(${agentName}) timed out after ${timeoutMs}ms`
      );
      e.status = 504;
      throw e;
    }
    throw err;
  }
  clearTimeout(timer);

  const requestId =
    res.headers.get("x-ms-request-id") ??
    res.headers.get("apim-request-id") ??
    undefined;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep text as-is
    }
    const err: InvokeError = new Error(
      `Foundry invokeAgent(${agentName}) failed: HTTP ${res.status} ${res.statusText}`
    );
    err.status = res.status;
    err.requestId = requestId;
    err.body = parsed;
    throw err;
  }

  return (await res.json()) as ResponsesEnvelope;
}

/**
 * Flatten an envelope's output items into a simple chat-friendly shape.
 *
 * - `text`: concatenated assistant output_text
 * - `imageBase64`: first completed image_generation_call result, if any
 *   (stored as a single base64 string, or `null` when none)
 * - `toolCalls`: function_call items the agent emitted (already executed by
 *    the agent runtime — these are for activity logging, not for client-side
 *    execution)
 */
export function flattenEnvelope(env: ResponsesEnvelope): {
  text: string;
  imageBase64: string | null;
  toolCalls: ResponsesFunctionCall[];
} {
  let text = "";
  const images: string[] = [];
  const toolCalls: ResponsesFunctionCall[] = [];

  for (const item of env.output ?? []) {
    if (item.type === "message") {
      const msg = item as ResponsesOutputMessage;
      for (const part of msg.content ?? []) {
        if (part.type === "output_text") text += (text ? "\n" : "") + part.text;
      }
    } else if (item.type === "function_call") {
      toolCalls.push(item as ResponsesFunctionCall);
    } else if (item.type === "image_generation_call") {
      const img = item as ResponsesImageGenerationCall;
      if (img.status === "completed" && img.result) {
        images.push(img.result);
      }
    }
  }

  // Collect all images: single image as raw string, multiple as JSON array.
  let imageBase64: string | null = null;
  if (images.length === 1) {
    imageBase64 = images[0];
  } else if (images.length > 1) {
    imageBase64 = JSON.stringify(images);
  }

  return { text, imageBase64, toolCalls };
}

// ---------------------------------------------------------------------------
// Direct Azure OpenAI image generation (gpt-image-2)
// ---------------------------------------------------------------------------

export interface GenerateImagesOptions {
  /** Text prompt for the image model. */
  prompt: string;
  /** Number of images to generate (1-10, capped safely). */
  n?: number;
  /** Image quality forwarded from UI controls. */
  quality?: "auto" | "low" | "medium" | "high";
  /** Size preset forwarded from UI controls. */
  size?: "auto" | "1024x1024" | "1024x1536" | "1536x1024";
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Per-request timeout. Defaults to 3 minutes. */
  timeoutMs?: number;
  /**
   * BYOK ("Bring Your Own Key") OpenAI API key. When supplied, route
   * the call to public OpenAI's `/v1/images/generations` (gpt-image-1)
   * with this bearer instead of Azure-managed-identity Foundry. Lives
   * in memory for this single call; never logged or persisted.
   */
  byokOpenAIKey?: string;
}

/** Generate images directly via Azure OpenAI (gpt-image-2-1). The Foundry
 *  hosted agent cannot reliably expose hosted image-generation tools today,
 *  so the Node backend calls the deployment directly. Azure OpenAI data-plane
 *  endpoints require the Cognitive Services token audience, not the Foundry
 *  `ai.azure.com` audience used by hosted-agent Responses. */
export async function generateImages(
  opts: GenerateImagesOptions
): Promise<{ images: string[]; droppedCount: number; errors: string[] }> {
  // BYOK fast-path: user supplied an OpenAI key. Route to public OpenAI
  // and skip all Azure-side managed-identity / endpoint plumbing. The
  // key is read once into a local const and is NEVER logged or
  // persisted (the response body is base64 image data only).
  const useByok = !!opts.byokOpenAIKey && opts.byokOpenAIKey.trim().length > 0;

  let url: string;
  let authHeader: string;
  if (useByok) {
    url = "https://api.openai.com/v1/images/generations";
    authHeader = `Bearer ${opts.byokOpenAIKey!.trim()}`;
  } else {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    if (!endpoint) {
      throw new Error(
        "AZURE_OPENAI_ENDPOINT not set in environment (and no BYOK OpenAI key supplied)"
      );
    }
    const deployment = process.env.AZURE_AI_IMAGE_DEPLOYMENT ?? "gpt-image-2-1";
    url =
      `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}` +
      `/images/generations?api-version=2025-03-01-preview`;
    const token = await getBearer(AZURE_OPENAI_TOKEN_AUDIENCE);
    authHeader = `Bearer ${token}`;
  }

  const count = Math.min(Math.max(opts.n ?? 1, 1), 10);
  const size = opts.size === "auto" || !opts.size ? undefined : opts.size;
  const quality =
    opts.quality === "auto" || !opts.quality ? undefined : opts.quality;

  const body: Record<string, unknown> = {
    prompt: opts.prompt.slice(0, 32000),
  };
  if (size) body.size = size;
  if (quality) body.quality = quality;
  if (useByok) {
    // Public OpenAI's gpt-image-1 needs an explicit `model` field +
    // `response_format: b64_json` to return inline data (default for
    // gpt-image-1 is base64 already but be explicit). Azure's gpt-image-2-1
    // infers the model from the deployment slug in the URL.
    body.model = "gpt-image-1";
    body.response_format = "b64_json";
  }

  const timeoutCtl = new AbortController();
  const timer = setTimeout(() => timeoutCtl.abort(), opts.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS);
  const signal = opts.signal
    ? anySignal([opts.signal, timeoutCtl.signal])
    : timeoutCtl.signal;

  // Azure gpt-image-2-1 frequently returns HTTP 429 `EngineOverloaded` during
  // peak hours — transient, capacity-side. Retry with exponential backoff
  // (max 3 attempts per image) before giving up. Honour Retry-After if set.
  // gpt-image-2 supports n=1 per call, so generate N images in parallel,
  // each with its own retry budget.
  const MAX_ATTEMPTS = 3;
  const RETRY_BASE_MS = 1500;
  const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

  async function callOnce(): Promise<Response> {
    let lastRes: Response | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new Error("aborted");
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
        });
        if (res.ok) return res;
        if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) {
          return res;
        }
        // Drain body so we can retry without TCP socket weirdness.
        await res.text().catch(() => "");
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader
          ? Number(retryAfterHeader) * 1000
          : RETRY_BASE_MS * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 400;
        await new Promise((r) => setTimeout(r, retryAfterMs + jitter));
        lastRes = res;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") throw err;
        lastErr = err;
        if (attempt === MAX_ATTEMPTS) throw err;
        await new Promise((r) =>
          setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt - 1)),
        );
      }
    }
    if (lastRes) return lastRes;
    throw lastErr ?? new Error("image_generation_unknown_failure");
  }

  const calls = Array.from({ length: count }, () => callOnce());

  const settled = await Promise.allSettled(calls);
  clearTimeout(timer);
  const images: string[] = [];
  const errors: string[] = [];
  let droppedCount = 0;

  for (const res of settled) {
    if (res.status !== "fulfilled") {
      droppedCount++;
      errors.push(res.reason instanceof Error ? res.reason.message : String(res.reason));
      continue;
    }
    if (!res.value.ok) {
      droppedCount++;
      const text = await res.value.text().catch(() => "");
      errors.push(`HTTP ${res.value.status} ${res.value.statusText}: ${text.slice(0, 500)}`);
      continue;
    }
    let json: { data?: Array<{ b64_json?: string }> };
    try {
      json = (await res.value.json()) as typeof json;
    } catch (err) {
      droppedCount++;
      errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    const b64 = json.data?.[0]?.b64_json;
    if (b64) images.push(b64);
    else {
      droppedCount++;
      errors.push("Image response did not include data[0].b64_json");
    }
  }

  return { images, droppedCount, errors };
}
