"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./apiClient";
import {
  detectOllama,
  getDefaultOllamaModel,
  ollamaChat,
  ollamaChatWithTools,
  type OllamaTool,
  type OllamaToolCall,
} from "./ollamaClient";
import type {
  ConversationDetail,
  ConversationSummary,
  FactRow,
  ImageQuality,
  ImageSize,
  Persona,
  ReasoningProfile,
  ToolsMode,
  UserProfileRow,
} from "./types";

// Tool schema the local model can call
const CREATE_TODO_TOOL: OllamaTool = {
  type: "function",
  function: {
    name: "create_todo",
    description: "Create a new task / todo item for the user. Use this when the user asks you to remember or schedule something.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title of the task" },
        description: { type: "string", description: "Optional longer description" },
        priority: { type: "string", description: "low | medium | high" },
      },
      required: ["title"],
    },
  },
};

const READ_FILE_TOOL: OllamaTool = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read a text file by path (relative to repo root).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file" },
      },
      required: ["path"],
    },
  },
};

const LIST_DIRECTORY_TOOL: OllamaTool = {
  type: "function",
  function: {
    name: "list_directory",
    description: "List files and directories at a path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path, default '.'" },
      },
      required: [],
    },
  },
};

const WRITE_FILE_TOOL: OllamaTool = {
  type: "function",
  function: {
    name: "write_file",
    description: "Write content to a file. REQUIRES APPROVAL.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        content: { type: "string", description: "Full new file content" },
      },
      required: ["path", "content"],
    },
  },
};

const SEARCH_REPLACE_TOOL: OllamaTool = {
  type: "function",
  function: {
    name: "search_replace",
    description: "Replace the first occurrence of search with replace. REQUIRES APPROVAL.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        search: { type: "string" },
        replace: { type: "string" },
      },
      required: ["path", "search", "replace"],
    },
  },
};

const GREP_TOOL: OllamaTool = {
  type: "function",
  function: {
    name: "grep",
    description: "Search code for a pattern.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        max_results: { type: "integer" },
      },
      required: ["pattern"],
    },
  },
};

const FIND_FILES_TOOL: OllamaTool = {
  type: "function",
  function: {
    name: "find_files",
    description: "Find files by glob pattern.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        max_results: { type: "integer" },
      },
      required: ["pattern"],
    },
  },
};

const GIT_STATUS_TOOL: OllamaTool = {
  type: "function",
  function: {
    name: "git_status",
    description: "Get git status (short).",
    parameters: {
      type: "object",
      properties: { cwd: { type: "string" } },
      required: [],
    },
  },
};

const GIT_DIFF_TOOL: OllamaTool = {
  type: "function",
  function: {
    name: "git_diff",
    description: "Get git diff against target.",
    parameters: {
      type: "object",
      properties: { cwd: { type: "string" }, target: { type: "string" } },
      required: [],
    },
  },
};

const LOCAL_TOOL_DEFS: OllamaTool[] = [
  CREATE_TODO_TOOL,
  READ_FILE_TOOL,
  LIST_DIRECTORY_TOOL,
  WRITE_FILE_TOOL,
  SEARCH_REPLACE_TOOL,
  GREP_TOOL,
  FIND_FILES_TOOL,
  GIT_STATUS_TOOL,
  GIT_DIFF_TOOL,
];

type ToolExecResult =
  | { status: "ok"; output: string; diff?: string; rollbackDir?: string }
  | { status: "awaiting_approval"; approvalId: string; description: string }
  | { status: "error"; error: string };

async function executeToolCall(
  toolCall: OllamaToolCall,
  conversationId?: string | null,
): Promise<ToolExecResult> {
  const name = toolCall.function.name;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.function.arguments || "{}");
  } catch {
    return { status: "error", error: "invalid_arguments" };
  }

  if (name === "create_todo") {
    try {
      const res = await api<{ id: string; title: string }>("/api/tools/create_todo", {
        method: "POST",
        body: {
          title: typeof args.title === "string" ? args.title : "Untitled",
          description: typeof args.description === "string" ? args.description : undefined,
          priority:
            typeof args.priority === "string" ? args.priority : "medium",
        },
      });
      return { status: "ok", output: JSON.stringify({ success: true, todoId: res.id, title: res.title }) };
    } catch (err) {
      return { status: "error", error: String(err) };
    }
  }

  try {
    const payload = {
      toolName: name,
      paramsJson: JSON.stringify(args),
      conversationId: conversationId ?? undefined,
    };
    const res = await api<{ status: string; approvalId?: string; result?: Record<string, unknown> }>("/api/tools/execute", {
      method: "POST",
      body: payload,
    });

    if (res.status === "awaiting_approval" && res.approvalId) {
      return { status: "awaiting_approval", approvalId: res.approvalId, description: `${name} requested` };
    }

    if (res.status === "completed") {
      return {
        status: "ok",
        output: JSON.stringify(res.result ?? {}),
        diff: typeof res.result?.diff === "string" ? res.result.diff : undefined,
        rollbackDir: typeof res.result?.rollbackDir === "string" ? res.result.rollbackDir : undefined,
      };
    }

    return { status: "error", error: `tool_failed:${res.status}` };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}

export function useProjects() {
  const [projects, setProjects] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const data = await api<{ projects: string[] }>("/api/conversations/projects");
      setProjects(data.projects);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { projects, reload, error };
}

export function useConversations(projectFilter: string, searchQuery: string) {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const query: Record<string, string | undefined> = {
        project: projectFilter || undefined,
        q: searchQuery.trim() || undefined,
      };
      const data = await api<{ conversations: ConversationSummary[] }>(
        "/api/conversations",
        { query }
      );
      setItems(data.conversations);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    }
  }, [projectFilter, searchQuery]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, reload, error };
}

export function useConversationDetail(id: string | null) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      const data = await api<{ conversation: ConversationDetail }>(
        `/api/conversations/${id}`
      );
      setDetail(data.conversation);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
      setDetail(null);
    }
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { detail, reload, error };
}

export interface SendArgs {
  conversationId?: string;
  message: string;
  reasoningProfile: ReasoningProfile;
  toolsMode: ToolsMode;
  persona?: Persona;
  project?: string;
  imageQuality?: ImageQuality;
  imageSize?: ImageSize;
  imageBase64?: string;
}

export interface SendResult {
  conversation: { id: string; title: string; project: string | null };
  taskKind: string;
  persona: Persona;
  toolsMode: ToolsMode;
  droppedImage?: boolean;
  assistant: { id: string; text: string | null; imageBase64: string | null };
  factsExtracted?: number;
  loopCount?: number;
  approvalsCreated?: string[];
}

export interface StreamState {
  status: string | null;
  imageProgress: { current: number; total: number } | null;
  partialMessage: { text: string | null; imageBase64: string | null; persona: Persona | null } | null;
  toolCalls: Array<{ name: string; arguments: string; call_id: string }>;
  toolResults: Array<{ call_id: string; name: string; output: string; status: string; diff?: string; rollbackDir?: string }>;
  approvalsRequired: Array<{ call_id: string; name: string; approvalId: string; description: string }>;
  loopCount: number;
}

/**
 * Run a turn entirely against the user's local Ollama, then POST the
 * finalized assistant message to /api/chat/finalize for persistence.
 *
 * Why this lives outside `useSendMessage`: it doesn't need React state
 * hooks itself, and pulling it out keeps the hook readable.
 */
async function sendViaOllama(args: {
  args: SendArgs;
  modelName: string;
  signal: AbortSignal;
  onToken?: (delta: string) => void;
  onToolCall?: (tool: { name: string; arguments: string; call_id: string }) => void;
  onToolResult?: (result: { call_id: string; name: string; output: string; status: string; diff?: string; rollbackDir?: string }) => void;
  onApprovalRequired?: (approval: { call_id: string; name: string; approvalId: string; description: string; paramsJson: string }) => void;
}): Promise<SendResult | null> {
  const { args: req, modelName, signal, onToken, onToolCall, onToolResult, onApprovalRequired } = args;
  if (signal.aborted) throw new Error("Aborted by user");

  // Compose Ollama messages. We keep this minimal in v1 — no full
  // conversation history replay, because /api/chat/finalize will be
  // updated to load history server-side if/when we need it. For now
  // each turn is independent. The persona prompt is left to the model
  // (Ollama doesn't see our `agent-config/*.prompt.md` system prompts
  // unless we send them); we ship a short, generic system line.
  const systemPrompt =
    "You are a helpful coworker assistant. Answer concisely and execute the user's request directly when possible. " +
    "You can call tools to read files, search, and edit the repo. " +
    "Any destructive action (write_file, search_replace) requires human approval; ask for it by calling the tool anyway and wait. " +
    "No emoji unless the user uses them first.";

  const userText = req.message;

  // Try tool-aware call first (many coding models support it)
  let chatResult: Awaited<ReturnType<typeof ollamaChatWithTools>>;
  try {
    chatResult = await ollamaChatWithTools({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      tools: LOCAL_TOOL_DEFS,
      tool_choice: "auto",
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw new Error("Aborted by user");
    // Fallback to plain chat if the model doesn't support tools
    chatResult = (await ollamaChat({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      signal,
      onToken,
    })) as Awaited<ReturnType<typeof ollamaChatWithTools>>;
  }

  // Execute any tool calls the model requested
  if (chatResult.toolCalls && chatResult.toolCalls.length > 0) {
    for (const tc of chatResult.toolCalls) {
      const callId = tc.id || tc.function.name + "_" + Date.now();
      onToolCall?.({ name: tc.function.name, arguments: tc.function.arguments, call_id: callId });
      const result = await executeToolCall(tc, req.conversationId);
      if (result.status === "awaiting_approval") {
        onApprovalRequired?.({
          call_id: callId,
          name: tc.function.name,
          approvalId: result.approvalId,
          description: result.description,
          paramsJson: tc.function.arguments,
        });
        chatResult.text =
          (chatResult.text ? chatResult.text + "\n\n" : "") +
          `Approval required for ${tc.function.name}.`;
      } else if (result.status === "ok") {
        onToolResult?.({
          call_id: callId,
          name: tc.function.name,
          output: result.output,
          status: "ok",
          diff: result.diff,
          rollbackDir: result.rollbackDir,
        });
        chatResult.text =
          (chatResult.text ? chatResult.text + "\n\n" : "") +
          `Tool result (${tc.function.name}): ${result.output}`;
      } else {
        onToolResult?.({
          call_id: callId,
          name: tc.function.name,
          output: result.error,
          status: "error",
        });
        chatResult.text =
          (chatResult.text ? chatResult.text + "\n\n" : "") +
          `Tool error (${tc.function.name}): ${result.error}`;
      }
    }
  }

  // POST finalized turn for persistence. If this fails the UI still
  // shows the assistant text the user already saw streamed in; we just
  // surface the persistence error.
  const finalized = await api<{
    conversation: { id: string; title: string; project: string | null };
    assistant: { id: string; text: string | null; modelUsed: string; createdAt: string };
    factsExtracted: number;
  }>("/api/chat/finalize", {
    method: "POST",
    body: {
      conversationId: req.conversationId,
      userMessage: userText,
      assistantText: chatResult.text,
      modelUsed: `ollama:${modelName}`,
      provider: "ollama",
      promptTokens: chatResult.promptTokens,
      completionTokens: chatResult.completionTokens,
      persona: req.persona,
      project: req.project,
    },
  });

  return {
    conversation: finalized.conversation,
    taskKind: "general_chat",
    persona: req.persona ?? "orchestrator",
    toolsMode: req.toolsMode,
    assistant: {
      id: finalized.assistant.id,
      text: finalized.assistant.text,
      imageBase64: null,
    },
    factsExtracted: finalized.factsExtracted,
  };
}

export function useSendMessage() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<StreamState>({
    status: null,
    imageProgress: null,
    partialMessage: null,
    toolCalls: [],
    toolResults: [],
    approvalsRequired: [],
    loopCount: 0,
  });
  const abortRef = useRef<AbortController | null>(null);
  const localApprovalsRef = useRef<
    Map<string, { call_id: string; name: string; paramsJson: string }>
  >(new Map());

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const send = useCallback(async (args: SendArgs): Promise<SendResult | null> => {
    setSending(true);
    setError(null);
    setStreamState({
      status: "thinking",
      imageProgress: null,
      partialMessage: null,
      toolCalls: [],
      toolResults: [],
      approvalsRequired: [],
      loopCount: 0,
    });

    const controller = new AbortController();
    abortRef.current = controller;

    // ── Ollama-first branch ─────────────────────────────────────────
    // If the user has selected a local Ollama model AND Ollama is
    // reachable, run the LLM call entirely client-side and POST the
    // finalized turn to /api/chat/finalize for persistence. Keeps
    // the user's prompt off our server, and means the server doesn't
    // need to reach the user's local Ollama (it can't, anyway).
    const ollamaModel = getDefaultOllamaModel();
    if (ollamaModel && !args.imageBase64 && !args.imageQuality && !args.imageSize) {
      const detect = await detectOllama();
      if (detect.reachable) {
        try {
          const result = await sendViaOllama({
            args,
            modelName: ollamaModel,
            signal: controller.signal,
            onToken: (delta) => {
              setStreamState((prev) => ({
                ...prev,
                status: "streaming",
                partialMessage: {
                  text: (prev.partialMessage?.text ?? "") + delta,
                  imageBase64: null,
                  persona: args.persona ?? null,
                },
              }));
            },
            onToolCall: (tool) => {
              setStreamState((prev) => ({
                ...prev,
                toolCalls: [...prev.toolCalls, tool],
                status: `running ${tool.name}...`,
              }));
            },
            onToolResult: (result) => {
              setStreamState((prev) => ({
                ...prev,
                toolResults: [...prev.toolResults, result],
                status: `${result.name} done`,
              }));
            },
            onApprovalRequired: (approval) => {
              localApprovalsRef.current.set(approval.approvalId, {
                call_id: approval.call_id,
                name: approval.name,
                paramsJson: approval.paramsJson,
              });
              setStreamState((prev) => ({
                ...prev,
                approvalsRequired: [
                  ...prev.approvalsRequired,
                  {
                    call_id: approval.call_id,
                    name: approval.name,
                    approvalId: approval.approvalId,
                    description: approval.description,
                  },
                ],
                status: `approval required: ${approval.name}`,
              }));
            },
          });
          return result;
        } catch (err) {
          if (err instanceof Error && err.message === "Aborted by user") {
            setError("Stopped by user");
          } else if (err instanceof ApiError) {
            setError(`${err.code} (${err.status})`);
          } else {
            setError(String(err));
          }
          return null;
        } finally {
          setSending(false);
          abortRef.current = null;
        }
      }
      // Ollama selected but not reachable: fall through to server.
      // The Settings UI surfaces the install hint separately.
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        throw new Error("Aborted by user");
      }

      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "unknown" }));
        throw new ApiError(
          res.status,
          typeof payload.error === "string" ? payload.error : "request_failed"
        );
      }

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: SendResult | null = null;

      while (true) {
        if (controller.signal.aborted) {
          await reader.cancel();
          throw new Error("Aborted by user");
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const chunk of lines) {
          const eventMatch = chunk.match(/^event: (\w+)$/m);
          const dataMatch = chunk.match(/^data: (.+)$/m);
          if (!eventMatch || !dataMatch) continue;

          const event = eventMatch[1];
          const data = JSON.parse(dataMatch[1]);

          if (event === "status") {
            setStreamState((prev) => ({ ...prev, status: data.status, loopCount: data.loop ?? prev.loopCount }));
          } else if (event === "image_progress") {
            setStreamState((prev) => ({ ...prev, imageProgress: { current: data.current, total: data.total } }));
          } else if (event === "assistant_text") {
            setStreamState((prev) => ({
              ...prev,
              partialMessage: {
                text: data.text,
                imageBase64: null,
                persona: null,
              },
            }));
          } else if (event === "tool_call") {
            setStreamState((prev) => ({
              ...prev,
              toolCalls: [...prev.toolCalls, { name: data.name, arguments: data.arguments, call_id: data.call_id }],
              status: `running ${data.name}...`,
            }));
          } else if (event === "tool_result") {
            setStreamState((prev) => ({
              ...prev,
              toolResults: [...prev.toolResults, data],
              status: `${data.name} done`,
            }));
          } else if (event === "approval_required") {
            setStreamState((prev) => ({
              ...prev,
              approvalsRequired: [...prev.approvalsRequired, {
                call_id: data.call_id,
                name: data.name,
                approvalId: data.approvalId,
                description: data.description,
              }],
              status: `approval required: ${data.name}`,
            }));
          } else if (event === "message") {
            setStreamState((prev) => ({
              ...prev,
              partialMessage: {
                text: data.text,
                imageBase64: data.imageBase64,
                persona: data.persona,
              },
            }));
          } else if (event === "done") {
            result = data as SendResult;
          } else if (event === "error") {
            throw new ApiError(data.status ?? 502, data.code ?? "stream_error");
          }
        }
      }

      return result;
    } catch (err) {
      if (err instanceof Error && err.message === "Aborted by user") {
        setError("Stopped by user");
      } else if (err instanceof ApiError) {
        setError(`${err.code} (${err.status})`);
      } else {
        setError(String(err));
      }
      return null;
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, []);

  const handleLocalApproval = useCallback(async (approvalId: string) => {
    if (!localApprovalsRef.current.has(approvalId)) return;
    try {
      const res = await api<{ status: string; result?: Record<string, unknown> }>("/api/tools/execute", {
        method: "POST",
        body: { approvalId },
      });

      if (res.status === "completed") {
        setStreamState((prev) => ({
          ...prev,
          approvalsRequired: prev.approvalsRequired.filter((a) => a.approvalId !== approvalId),
          toolResults: [
            ...prev.toolResults,
            {
              call_id: localApprovalsRef.current.get(approvalId)?.call_id ?? approvalId,
              name: localApprovalsRef.current.get(approvalId)?.name ?? "tool",
              output: JSON.stringify(res.result ?? {}),
              status: "ok",
              diff: typeof res.result?.diff === "string" ? res.result.diff : undefined,
              rollbackDir: typeof res.result?.rollbackDir === "string" ? res.result.rollbackDir : undefined,
            },
          ],
        }));
      }
    } finally {
      localApprovalsRef.current.delete(approvalId);
    }
  }, []);

  return { send, sending, error, streamState, abort, handleLocalApproval };
}

export function useApproveOpenUrl() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const approve = useCallback(async (taskId: string) => {
    setPending(taskId);
    setError(null);
    try {
      await api(`/api/tools/open_url/approve/${taskId}`, { method: "POST" });
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
      throw err;
    } finally {
      setPending(null);
    }
  }, []);
  return { approve, pending, error };
}

// ---------------------------------------------------------------------------
// Memory hooks
// ---------------------------------------------------------------------------

export function useProfile() {
  const [profile, setProfile] = useState<UserProfileRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const data = await api<{ profile: UserProfileRow }>("/api/profile");
      setProfile(data.profile);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { profile, reload, error };
}

export function useFacts(category?: string) {
  const [items, setItems] = useState<FactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const query: Record<string, string | undefined> = {};
      if (category) query.category = category;
      const data = await api<{ items: FactRow[]; total: number }>("/api/facts", { query });
      setItems(data.items);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    }
  }, [category]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, total, reload, error };
}

// ---------------------------------------------------------------------------
// Project workspace hooks
// ---------------------------------------------------------------------------

export interface ProjectWorkspace {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  goalsJson: string;
  pinnedPathsJson: string;
  repoRoot: string | null;
  status: string;
}

export function useProjectWorkspaces() {
  const [items, setItems] = useState<ProjectWorkspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const data = await api<{ projects: ProjectWorkspace[] }>("/api/projects");
      setItems(data.projects);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, reload, error };
}

export function useRegenerateTitle() {
  const [pending, setPending] = useState(false);
  const regenerate = useCallback(async (conversationId: string) => {
    setPending(true);
    try {
      return await api<{ conversation: { title: string } }>(
        `/api/conversations/${conversationId}/title`,
        { method: "PATCH" }
      );
    } catch (err) {
      if (err instanceof ApiError) console.error(`${err.code} (${err.status})`);
      else console.error(String(err));
      return null;
    } finally {
      setPending(false);
    }
  }, []);
  return { regenerate, pending };
}

// ---------------------------------------------------------------------------
// Approvals hook
// ---------------------------------------------------------------------------

export interface ApprovalRow {
  id: string;
  toolName: string;
  description: string;
  status: string;
  createdAt: string;
}

export function useApprovals() {
  const [items, setItems] = useState<ApprovalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const data = await api<{ approvals: ApprovalRow[] }>("/api/approvals");
      setItems(data.approvals);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, reload, error };
}

export function useRollbacks() {
  const [items, setItems] = useState<Array<{ id: string; snapshotDir: string; pathsJson: string; createdAt: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const data = await api<{ snapshots: Array<{ id: string; snapshotDir: string; pathsJson: string; createdAt: string }> }>("/api/rollback");
      setItems(data.snapshots);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    }
  }, []);
  const restore = useCallback(async (snapshotDir: string) => {
    try {
      return await api<{ restored: boolean }>("/api/rollback", {
        method: "POST",
        body: { snapshotDir },
      });
    } catch (err) {
      if (err instanceof ApiError) console.error(`rollback failed: ${err.code} (${err.status})`);
      else console.error(String(err));
      return null;
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, reload, error, restore };
}

export function useResolveApproval() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolve = useCallback(async (id: string, decision: "approved" | "rejected") => {
    setPending(id);
    setError(null);
    try {
      return await api<{ approval: ApprovalRow }>(`/api/approvals/${id}`, {
        method: "POST",
        body: { decision },
      });
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
      return null;
    } finally {
      setPending(null);
    }
  }, []);
  return { resolve, pending, error };
}

// ----------------------------------------------------------------------------
// Plans — coworker task strip data source.
// ----------------------------------------------------------------------------

import type { PlanRow } from "./types";

/**
 * Fetches the most recent plans for the current user. The UI uses this as
 * the data source for the persistent task strip ("checklist sidebar") that
 * ticks off as the agent executes steps.
 */
export function usePlans(opts: { conversationId?: string | null; activeOnly?: boolean } = {}) {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const query: Record<string, string | undefined> = {};
      if (opts.activeOnly) query.status = "running";
      const data = await api<{ plans: PlanRow[] }>("/api/plans", { query });
      const filtered = opts.conversationId
        ? data.plans.filter((p) => p.conversationId === opts.conversationId)
        : data.plans;
      setPlans(filtered);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [opts.activeOnly, opts.conversationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { plans, reload, error, loading };
}
