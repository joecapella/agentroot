/** Shared client/UI types — not exported from server-only modules. */

export type Persona =
  | "orchestrator"
  | "code_assistant"
  | "brand_designer"
  | "ops"
  | "vision";

export type ReasoningProfile = "fast" | "balanced" | "deep";
export type ToolsMode = "off" | "ask" | "allowed";

/**
 * Image options for the hosted `image_generation` tool (gpt-image-2).
 *
 * - `quality`: maps to the tool's `quality` param. `auto` lets the model pick.
 * - `size`: gpt-image-2 supports many resolutions (max edge 3840px); we only
 *   surface the three documented presets plus `auto` to keep the UI honest
 *   about what's been validated end-to-end. Custom sizes are intentionally
 *   not exposed in v1.
 *
 * Note (2026-05-12): the hosted CofounderAgent container does not yet wire
 * the `image_generation` tool into its LangGraph. These options are
 * forward-compatible — they round-trip through the Responses request and
 * become active the moment the container exposes the tool. Until then they
 * are recorded on the user message for replay/intent only.
 */
export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageSize = "auto" | "1024x1024" | "1024x1536" | "1536x1024";

export interface ConversationSummary {
  id: string;
  title: string;
  project: string | null;
  lastMessageAt: string;
  createdAt: string;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  sender: "user" | "assistant" | "system" | "tool";
  persona: Persona | null;
  text: string | null;
  imageBase64: string | null;
  toolCallsJson: string | null;
  taskKind: string | null;
  modelUsed: string | null;
  createdAt: string;
}

export interface TaskRow {
  id: string;
  userId: string;
  conversationId: string | null;
  type: string;
  status: string;
  paramsJson: string;
  resultJson: string | null;
  summary: string | null;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  title: string;
  project: string | null;
  messages: MessageRow[];
  tasks: TaskRow[];
}

// ---------------------------------------------------------------------------
// Memory types
// ---------------------------------------------------------------------------

export const FACT_CATEGORIES = [
  "preference",
  "constraint",
  "project_knowledge",
  "lesson_learned",
  "identity",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export interface FactRow {
  id: string;
  userId: string;
  category: FactCategory;
  label: string;
  fullText: string;
  importance: number;
  source: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfileRow {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  defaultReasoning: ReasoningProfile;
  defaultTools: ToolsMode;
  defaultPersona: "auto" | Persona;
  preferencesJson: string;
  createdAt: string;
  updatedAt: string;
}
