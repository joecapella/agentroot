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
const TOKEN_REFRESH_SAFETY_MS = 2 * 60 * 1000;
/** Default upstream timeout. Long enough for deep_planning + tool loops,
 *  short enough that a hung Foundry doesn't lock up /api/chat forever. */
const DEFAULT_INVOKE_TIMEOUT_MS = 60_000;

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
let _cachedToken: AccessToken | null = null;

function credential(): DefaultAzureCredential {
  if (!_credential) _credential = new DefaultAzureCredential();
  return _credential;
}

async function getBearer(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresOnTimestamp - now > TOKEN_REFRESH_SAFETY_MS) {
    return _cachedToken.token;
  }
  const tok = await credential().getToken(TOKEN_AUDIENCE);
  if (!tok) throw new Error("Failed to acquire Azure AD token for Foundry");
  _cachedToken = tok;
  return tok.token;
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
    | Array<{ role: "user" | "assistant" | "developer"; content: string }>;
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
export async function invokeAgent(
  agentName: string,
  payload: Omit<ResponsesRequest, "model">,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ResponsesEnvelope> {
  const url = resolveEndpoint(agentName);
  const token = await getBearer();
  const body: ResponsesRequest = { model: agentName, ...payload } as ResponsesRequest;

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
  let imageBase64: string | null = null;
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
      if (img.status === "completed" && img.result && !imageBase64) {
        imageBase64 = img.result;
      }
    }
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
}

/** Generate images directly via Azure OpenAI (gpt-image-2-1). The Foundry
 *  hosted agent cannot reach out to external image APIs, so the Node backend
 *  calls the deployment directly with the same DefaultAzureCredential token. */
export async function generateImages(
  opts: GenerateImagesOptions
): Promise<{ images: string[]; droppedCount: number }> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (!endpoint) throw new Error("AZURE_OPENAI_ENDPOINT not set in environment");
  const deployment = process.env.AZURE_AI_IMAGE_DEPLOYMENT ?? "gpt-image-2-1";
  const url =
    `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}` +
    `/images/generations?api-version=2025-03-01-preview`;
  const token = await getBearer();

  const count = Math.min(Math.max(opts.n ?? 1, 1), 10);
  const size = opts.size === "auto" || !opts.size ? undefined : opts.size;
  const quality =
    opts.quality === "auto" || !opts.quality ? undefined : opts.quality;

  const body: Record<string, unknown> = {
    prompt: opts.prompt.slice(0, 32000),
  };
  if (size) body.size = size;
  if (quality) body.quality = quality;

  // Azure gpt-image-2 typically supports n=1 per call. Use parallel calls.
  const calls = Array.from({ length: count }, () =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  );

  const settled = await Promise.allSettled(calls);
  const images: string[] = [];
  let droppedCount = 0;

  for (const res of settled) {
    if (res.status !== "fulfilled" || !res.value.ok) {
      droppedCount++;
      continue;
    }
    let json: { data?: Array<{ b64_json?: string }> };
    try {
      json = (await res.value.json()) as typeof json;
    } catch {
      droppedCount++;
      continue;
    }
    const b64 = json.data?.[0]?.b64_json;
    if (b64) images.push(b64);
    else droppedCount++;
  }

  return { images, droppedCount };
}
