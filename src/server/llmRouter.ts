/**
 * Unified LLM invocation router.
 *
 * Dispatches to the Foundry hosted agent for azure_openai family models,
 * or to a direct provider (Gemini OpenAI-compat, OpenRouter, etc.) for
 * direct_openai family models.
 */

import {
  invokeAgentWithRetry,
  type ResponsesEnvelope,
  type ResponsesRequest,
} from "@/src/foundryClient";
import { invokeDirectOpenAI, invokeDirectAnthropic } from "./directProviders";
import type { DeploymentSpec, UserKeys } from "@/src/modelRouting";

export interface LLMPayload {
  input: ResponsesRequest["input"];
  instructions?: string;
  previous_response_id?: string;
}

export interface InvokeLLMOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * Whether to expose tools to the model when the target provider supports
   * request-level tool schemas.
   *
   * Direct OpenAI-compatible providers serialize this into `tools`. Foundry
   * hosted agents currently do not: they reject top-level `tools`, so their
   * tool availability comes from the container's LangChain `bind_tools(TOOLS)`.
   *
   * Default: true — the chat ReAct loop is the primary caller.
   * Set false for utility calls (title generation, fact distill).
   */
  attachTools?: boolean;
  /**
   * BYOK ("Bring Your Own Key") user-supplied API keys for this request.
   * Lives in memory for the duration of the call only; never logged,
   * never persisted server-side. The deployment spec's `userKeyName`
   * picks which one to use.
   */
  userKeys?: UserKeys;
}

export async function invokeLLM(
  spec: DeploymentSpec,
  agentName: string,
  payload: LLMPayload,
  opts: InvokeLLMOptions = {}
): Promise<ResponsesEnvelope> {
  const attachTools = opts.attachTools ?? true;
  // Resolve the BYOK key for this deployment, if any. The spec's
  // `userKeyName` says which key to pull from the per-request object.
  const userKey =
    spec.userKeyName && opts.userKeys
      ? opts.userKeys[spec.userKeyName]
      : undefined;

  if (spec.family === "direct_anthropic") {
    return invokeDirectAnthropic(spec, payload, {
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      attachTools,
      userKey,
    });
  }

  if (spec.family === "direct_openai") {
    return invokeDirectOpenAI(spec, payload, {
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      attachTools,
      userKey,
    });
  }

  // Default: Foundry hosted agent (azure_openai, image_gen fallbacks, etc.)
  return invokeAgentWithRetry(agentName, payload as unknown as Omit<ResponsesRequest, "model">, {
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
    maxRetries: opts.maxRetries,
    attachTools,
  });
}
