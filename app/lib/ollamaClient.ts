/**
 * Ollama client — runs in the BROWSER.
 *
 * Architecture: the user runs Ollama locally on their machine
 * (http://127.0.0.1:11434). The Node server cannot reach that — it's on
 * a different host (your dev box / Vercel / wherever). So the model
 * call originates from the browser tab directly to the user's local
 * Ollama, and only the final assistant text + token usage are POSTed
 * back to our server for persistence.
 *
 * That keeps the user's prompts off our server entirely (privacy win)
 * and lets us avoid any server-side model dependency.
 *
 * Ollama exposes an OpenAI-compatible endpoint at /v1, but we use the
 * native /api endpoints for detection (/api/version), model listing
 * (/api/tags), and streamed pulling (/api/pull) because those are
 * Ollama-specific.
 */

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/**
 * Resolve the Ollama base URL the browser should hit. Defaults to
 * localhost:11434; user can override via Settings (stored in
 * `byok.ollama.url`).
 */
export function getOllamaBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_OLLAMA_URL;
  try {
    const v = window.localStorage.getItem("byok.ollama.url");
    if (v && v.trim()) return v.trim().replace(/\/$/, "");
  } catch {
    // localStorage may be blocked in private mode; fall through.
  }
  return DEFAULT_OLLAMA_URL;
}

export interface OllamaDetectResult {
  reachable: boolean;
  version?: string;
  url: string;
  error?: string;
}

/**
 * Ping Ollama. Returns reachable=false (NOT an exception) when Ollama
 * isn't running — the onboarding UI keys off this without try/catch
 * noise in callers.
 *
 * Timeout: 2.5s. Most "is it running?" pings resolve in <50ms; the
 * upper bound just covers a slow first-boot Ollama.
 */
export async function detectOllama(
  baseUrl: string = getOllamaBaseUrl(),
): Promise<OllamaDetectResult> {
  const url = `${baseUrl}/api/version`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { reachable: false, url, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as { version?: string };
    return { reachable: true, version: json.version, url: baseUrl };
  } catch (err) {
    clearTimeout(timer);
    return {
      reachable: false,
      url: baseUrl,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at?: string;
  digest?: string;
}

export async function listOllamaModels(
  baseUrl: string = getOllamaBaseUrl(),
): Promise<OllamaModel[]> {
  const res = await fetch(`${baseUrl}/api/tags`);
  if (!res.ok) throw new Error(`ollama_list_failed: HTTP ${res.status}`);
  const json = (await res.json()) as { models?: OllamaModel[] };
  return json.models ?? [];
}

/**
 * Pull a model with live progress events. Yields each progress line
 * Ollama emits (it streams NDJSON). Caller can map to a progress bar.
 *
 * The pull may take minutes for a 4-8 GB model — the consumer should
 * keep the UI responsive (don't await the entire iterator on click).
 */
export async function* pullOllamaModel(
  modelName: string,
  baseUrl: string = getOllamaBaseUrl(),
  signal?: AbortSignal,
): AsyncGenerator<{
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}> {
  const res = await fetch(`${baseUrl}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelName, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`ollama_pull_failed: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // ignore malformed line; Ollama occasionally emits a half-line
      }
    }
  }
}

export interface OllamaChatOptions {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  baseUrl?: string;
  signal?: AbortSignal;
  /** Callback fired for each streamed token chunk. */
  onToken?: (delta: string) => void;
}

export interface OllamaChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalDurationMs: number;
}

/**
 * Send a chat completion to Ollama using its OpenAI-compatible
 * streaming endpoint. Returns the assembled text plus token usage.
 *
 * No API key needed — Ollama on localhost doesn't authenticate. If the
 * user has bound Ollama to a network address with auth, they'd need a
 * custom proxy; not in scope for v1.
 */
export async function ollamaChat(opts: OllamaChatOptions): Promise<OllamaChatResult> {
  const baseUrl = opts.baseUrl ?? getOllamaBaseUrl();
  const startedAt = performance.now();
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`ollama_chat_failed: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let promptTokens = 0;
  let completionTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          opts.onToken?.(delta);
        }
        if (json.usage) {
          promptTokens = json.usage.prompt_tokens ?? promptTokens;
          completionTokens = json.usage.completion_tokens ?? completionTokens;
        }
      } catch {
        // Some Ollama builds emit a non-OpenAI-formatted final line; ignore.
      }
    }
  }

  return {
    text,
    promptTokens,
    completionTokens,
    totalDurationMs: Math.round(performance.now() - startedAt),
  };
}

/**
 * Curated list of "small enough to be friendly on first install"
 * Ollama models. The onboarding UI shows these as one-click pulls.
 *
 * The picks balance: (1) sub-5GB so they fit on a laptop with modest
 * RAM, (2) decent at conversation, (3) free / non-restrictive license,
 * (4) actually published to the Ollama registry at these tags.
 */
export const CURATED_OLLAMA_MODELS: Array<{
  tag: string;
  label: string;
  sizeGB: number;
  hint: string;
}> = [
  {
    tag: "llama3.2:3b",
    label: "Llama 3.2 3B",
    sizeGB: 2,
    hint: "Fast all-rounder. Good first model.",
  },
  {
    tag: "qwen2.5:7b",
    label: "Qwen 2.5 7B",
    sizeGB: 4.7,
    hint: "Stronger reasoning, slower.",
  },
  {
    tag: "qwen2.5-coder:7b",
    label: "Qwen 2.5 Coder 7B",
    sizeGB: 4.7,
    hint: "Best for code tasks.",
  },
  {
    tag: "phi3.5:3.8b",
    label: "Phi 3.5 3.8B",
    sizeGB: 2.2,
    hint: "Tiny but capable. Microsoft's small model.",
  },
];

/** Local-storage keys used by the Ollama UI. */
export const OLLAMA_STORAGE_KEYS = {
  url: "byok.ollama.url",
  defaultModel: "byok.ollama.defaultModel",
  dismissed: "byok.ollama.installHintDismissed",
} as const;

export function getDefaultOllamaModel(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(OLLAMA_STORAGE_KEYS.defaultModel);
  } catch {
    return null;
  }
}

export function setDefaultOllamaModel(model: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (model) window.localStorage.setItem(OLLAMA_STORAGE_KEYS.defaultModel, model);
    else window.localStorage.removeItem(OLLAMA_STORAGE_KEYS.defaultModel);
  } catch {
    // localStorage blocked; user will need to re-set on next session
  }
}
