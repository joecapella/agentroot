/**
 * Direct-provider LLM invokers.
 *
 * These bypass the Foundry hosted agent and call APIs directly.
 * Currently supports any OpenAI-compatible endpoint (Gemini's OpenAI-compat
 * layer, OpenRouter, local vLLM, etc.).
 */

import {
  type ResponsesEnvelope,
  type ResponsesRequest,
  type ResponsesOutputItem,
  type ResponsesOutputMessage,
  type ResponsesFunctionCall,
} from "@/src/foundryClient";
import { TOOL_SCHEMAS } from "./toolsSchema";
import type { DeploymentSpec } from "@/src/modelRouting";
import type { LLMPayload } from "./llmRouter";

const DEFAULT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Request conversion: Responses protocol → OpenAI Chat Completions
// ---------------------------------------------------------------------------

interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export function convertInputToMessages(
  input: ResponsesRequest["input"],
  instructions?: string
): ChatCompletionMessage[] {
  const messages: ChatCompletionMessage[] = [];

  if (instructions) {
    messages.push({ role: "system", content: instructions });
  }

  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }

  for (const item of input) {
    if (typeof item === "object" && "type" in item && item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: item.output,
      });
      continue;
    }

    const msg = item as { role: string; content: unknown };
    const role = msg.role === "developer" ? "system" : (msg.role as "user" | "assistant" | "system");

    if (typeof msg.content === "string") {
      messages.push({ role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      const parts = msg.content.map((part: unknown) => {
        if (typeof part === "object" && part !== null && "type" in part) {
          const p = part as { type: string; text?: string; image_url?: { url: string } };
          if (p.type === "input_text") {
            return { type: "text" as const, text: p.text ?? "" };
          }
          if (p.type === "input_image" && p.image_url) {
            return { type: "image_url" as const, image_url: { url: p.image_url.url } };
          }
        }
        return { type: "text" as const, text: "" };
      });
      messages.push({ role, content: parts });
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Response conversion: OpenAI Chat Completions → ResponsesEnvelope
// ---------------------------------------------------------------------------

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
      refusal?: string | null;
    };
    finish_reason: string;
  }>;
  error?: { message: string; code: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export function convertCompletionToEnvelope(res: ChatCompletionResponse): ResponsesEnvelope {
  const choice = res.choices[0];
  if (!choice) {
    return {
      id: res.id,
      object: "response",
      status: "failed",
      error: { code: "no_choice", message: "Empty response from provider" },
      output: [],
    };
  }

  const output: ResponsesOutputItem[] = [];

  if (choice.message.content) {
    const msg: ResponsesOutputMessage = {
      type: "message",
      id: `${res.id}-msg`,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: choice.message.content }],
    };
    output.push(msg);
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      const fc: ResponsesFunctionCall = {
        type: "function_call",
        id: tc.id,
        call_id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        status: "completed",
      };
      output.push(fc);
    }
  }

  return {
    id: res.id,
    object: "response",
    status: "completed",
    error: null,
    output,
    usage: res.usage
      ? {
          prompt_tokens: res.usage.prompt_tokens,
          completion_tokens: res.usage.completion_tokens,
          total_tokens: res.usage.total_tokens,
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Invocation
// ---------------------------------------------------------------------------

export async function invokeDirectOpenAI(
  spec: DeploymentSpec,
  payload: LLMPayload,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    attachTools?: boolean;
    /**
     * BYOK ("Bring Your Own Key") override. When supplied, takes
     * precedence over `spec.apiKeyEnvVar`. Lets a per-request user key
     * (pasted into the Settings panel and held only in the browser's
     * localStorage) drive the call without ever being persisted
     * server-side.
     */
    userKey?: string;
  } = {}
): Promise<ResponsesEnvelope> {
  // Prefer the spec's hardcoded baseUrl (BYOK / public providers); fall
  // back to the env-var endpoint (Joseph's self-hosted / Ollama / Gemini
  // env config).
  const endpoint =
    spec.baseUrl ?? (spec.endpointEnvVar ? process.env[spec.endpointEnvVar] : undefined);
  const apiKey =
    opts.userKey ??
    (spec.apiKeyEnvVar ? process.env[spec.apiKeyEnvVar] : undefined);

  if (!endpoint) {
    throw new Error(
      `direct_provider_missing_endpoint: neither spec.baseUrl nor ${spec.endpointEnvVar} is set`
    );
  }

  const url = `${endpoint.replace(/\/$/, "")}/chat/completions`;
  const messages = convertInputToMessages(payload.input, payload.instructions);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const attachTools = opts.attachTools ?? true;
  const body: Record<string, unknown> = {
    model: spec.deployment,
    messages,
    temperature: 0.2,
    ...(attachTools
      ? {
          tools: TOOL_SCHEMAS.map((s) => ({ type: "function", function: s })),
          tool_choice: "auto",
        }
      : {}),
  };

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
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (timeoutCtl.signal.aborted) {
      const e = new Error(`Direct provider invoke timed out after ${timeoutMs}ms`) as Error & { status?: number };
      e.status = 504;
      throw e;
    }
    throw err;
  }
  clearTimeout(timer);

  let json: ChatCompletionResponse;
  try {
    json = (await res.json()) as ChatCompletionResponse;
  } catch (err) {
    const text = await res.text().catch(() => "");
    throw new Error(`Direct provider returned invalid JSON: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }

  if (json.error) {
    const e = new Error(`Direct provider error: ${json.error.code ?? "unknown"} — ${json.error.message}`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }

  if (!res.ok) {
    const e = new Error(`Direct provider failed: HTTP ${res.status}`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }

  return convertCompletionToEnvelope(json);
}

// ---------------------------------------------------------------------------
// Anthropic direct invoker (BYOK)
// ---------------------------------------------------------------------------

/**
 * Anthropic Messages API is NOT OpenAI-compatible:
 *  - Auth is `x-api-key`, not `Authorization: Bearer`.
 *  - System prompt is a top-level `system` field, not a `system` role.
 *  - Tool result blocks have a different shape.
 *  - Response shape is `content: [{type:"text", text}, {type:"tool_use", ...}]`.
 *
 * For v1 BYOK we ship a text-only converter. Tool calls are accepted in
 * the response but tool_result inputs go in as a text approximation so
 * the ReAct loop can still hand back observations. Good enough for the
 * "drop in your Claude key and use the agent" path; we can add real
 * tool_result blocks later if BYOK Anthropic becomes a hot path.
 */

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  >;
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type: string; message: string };
}

function convertInputToAnthropicMessages(
  input: ResponsesRequest["input"],
): { system: string | undefined; messages: AnthropicMessage[] } {
  let system: string | undefined;
  const messages: AnthropicMessage[] = [];

  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return { system, messages };
  }

  for (const item of input) {
    if (typeof item === "object" && "type" in item && item.type === "function_call_output") {
      // Anthropic tool_result blocks need a matching tool_use id from
      // the previous turn. For v1 BYOK we degrade gracefully: append the
      // tool output as a plain user message so the loop can continue.
      messages.push({
        role: "user",
        content: `[tool_result call_id=${item.call_id}]\n${item.output}`,
      });
      continue;
    }

    const msg = item as { role: string; content: unknown };
    const role: "user" | "assistant" =
      msg.role === "assistant" ? "assistant" : "user";

    if (msg.role === "developer" || msg.role === "system") {
      // Anthropic uses a single top-level `system` string; concatenate
      // if multiple system messages come through.
      const text =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as Array<{ text?: string }>)
                .map((p) => p.text ?? "")
                .join("\n")
            : "";
      system = system ? `${system}\n\n${text}` : text;
      continue;
    }

    if (typeof msg.content === "string") {
      messages.push({ role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      const parts: AnthropicMessage["content"] extends Array<infer P> ? P[] : never =
        [] as never;
      const collected: AnthropicMessage["content"] = [];
      for (const part of msg.content as Array<unknown>) {
        if (typeof part === "object" && part !== null && "type" in part) {
          const p = part as { type: string; text?: string; image_url?: { url: string } };
          if (p.type === "input_text") {
            collected.push({ type: "text", text: p.text ?? "" });
          } else if (p.type === "input_image" && p.image_url?.url) {
            // Expect data: URI (data:image/png;base64,...). Anthropic
            // wants base64 + media_type separately.
            const url = p.image_url.url;
            const m = url.match(/^data:([^;]+);base64,(.+)$/);
            if (m) {
              collected.push({
                type: "image",
                source: { type: "base64", media_type: m[1], data: m[2] },
              });
            } else {
              // Fallback: pass the URL inside text so we never silently drop it.
              collected.push({ type: "text", text: `[image_url:${url}]` });
            }
          }
        }
      }
      void parts;
      if (collected.length > 0) messages.push({ role, content: collected });
    }
  }

  return { system, messages };
}

function convertAnthropicToEnvelope(res: AnthropicResponse): ResponsesEnvelope {
  const output: ResponsesOutputItem[] = [];
  const textParts: string[] = [];

  for (const block of res.content ?? []) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      const fc: ResponsesFunctionCall = {
        type: "function_call",
        id: block.id,
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
        status: "completed",
      };
      output.push(fc);
    }
  }

  if (textParts.length > 0) {
    const msg: ResponsesOutputMessage = {
      type: "message",
      id: `${res.id}-msg`,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: textParts.join("\n") }],
    };
    output.unshift(msg);
  }

  return {
    id: res.id,
    object: "response",
    status: "completed",
    error: null,
    output,
    usage: res.usage
      ? {
          prompt_tokens: res.usage.input_tokens,
          completion_tokens: res.usage.output_tokens,
          total_tokens:
            (res.usage.input_tokens ?? 0) + (res.usage.output_tokens ?? 0),
        }
      : undefined,
  };
}

export async function invokeDirectAnthropic(
  spec: DeploymentSpec,
  payload: LLMPayload,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    attachTools?: boolean;
    userKey?: string;
  } = {}
): Promise<ResponsesEnvelope> {
  const endpoint = spec.baseUrl ?? "https://api.anthropic.com/v1";
  const apiKey =
    opts.userKey ??
    (spec.apiKeyEnvVar ? process.env[spec.apiKeyEnvVar] : undefined);

  if (!apiKey) {
    const e = new Error(
      "anthropic_missing_api_key: paste your Anthropic API key in Settings"
    ) as Error & { status?: number };
    e.status = 401;
    throw e;
  }

  const url = `${endpoint.replace(/\/$/, "")}/messages`;
  const { system, messages } = convertInputToAnthropicMessages(payload.input);
  const effectiveSystem = system ?? payload.instructions;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attachTools = opts.attachTools ?? true;

  const body: Record<string, unknown> = {
    model: spec.deployment,
    max_tokens: 4096,
    messages,
    ...(effectiveSystem ? { system: effectiveSystem } : {}),
    ...(attachTools
      ? {
          tools: TOOL_SCHEMAS.map((s) => ({
            name: s.name,
            description: s.description,
            input_schema: s.parameters,
          })),
        }
      : {}),
  };

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
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (timeoutCtl.signal.aborted) {
      const e = new Error(`Anthropic invoke timed out after ${timeoutMs}ms`) as Error & {
        status?: number;
      };
      e.status = 504;
      throw e;
    }
    throw err;
  }
  clearTimeout(timer);

  let json: AnthropicResponse;
  try {
    json = (await res.json()) as AnthropicResponse;
  } catch {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Anthropic returned invalid JSON: HTTP ${res.status} — ${text.slice(0, 200)}`
    );
  }

  if (!res.ok || json.error) {
    const e = new Error(
      `Anthropic error: HTTP ${res.status} — ${json.error?.message ?? "unknown"}`
    ) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }

  return convertAnthropicToEnvelope(json);
}

/** Compose multiple AbortSignals into a single one. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const builtin = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
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
