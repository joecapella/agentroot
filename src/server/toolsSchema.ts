/**
 * OpenAI function-schema definitions for all CofounderAgent tools.
 *
 * These mirror the Python `@tool` decorators in `src/CofounderAgent/main.py`.
 *
 * Request-level tool schemas are only sent to providers that support them.
 * Chat Completions uses `{ type:"function", function: { name, parameters } }`
 * (directProviders.ts). Responses-flat descriptors are kept as a converter for
 * future/non-hosted Responses surfaces, but Microsoft Foundry hosted-agent
 * endpoints currently reject top-level `tools`; CofounderAgent registers its
 * tools inside the container via LangChain `bind_tools(TOOLS)`.
 *
 * Use the converter exports below — never hand-roll the wrapper shape.
 */

import type { ResponsesFunctionTool } from "@/src/foundryClient";

export interface OpenAIFunction {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_SCHEMAS: OpenAIFunction[] = [
  {
    name: "add",
    description: "Add two numbers.",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  {
    name: "multiply",
    description: "Multiply two numbers.",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file at path (relative to repo root).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories at path.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", default: "." } },
      required: [],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file. DESTRUCTIVE — requires approval.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "search_replace",
    description: "Replace first occurrence of search with replace. DESTRUCTIVE.",
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
  {
    name: "run_command",
    description: "Run a shell command. REQUIRES APPROVAL.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string", default: "." },
      },
      required: ["command"],
    },
  },
  {
    name: "generate_image",
    description: "Generate an image from a text prompt. Returns a base64 data URL.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        quality: { type: "string", default: "auto" },
        size: { type: "string", default: "auto" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "fetch_url",
    description: "Fetch and return cleaned text from a URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        max_chars: { type: "integer", default: 8000 },
      },
      required: ["url"],
    },
  },
  {
    name: "grep",
    description: "Search code for pattern using ripgrep/grep.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", default: "." },
        max_results: { type: "integer", default: 50 },
      },
      required: ["pattern"],
    },
  },
  {
    name: "git_status",
    description: "Run git status --short.",
    parameters: {
      type: "object",
      properties: { cwd: { type: "string", default: "." } },
      required: [],
    },
  },
  {
    name: "git_diff",
    description: "Run git diff against target.",
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string", default: "." },
        target: { type: "string", default: "HEAD" },
      },
      required: [],
    },
  },
];

/**
 * Convert TOOL_SCHEMAS into the Chat Completions wrapper shape:
 *   { type: "function", function: { name, description, parameters } }
 * Used by direct OpenAI-compat providers.
 */
export function toolsForChatCompletions(): Array<{
  type: "function";
  function: OpenAIFunction;
}> {
  return TOOL_SCHEMAS.map((fn) => ({ type: "function" as const, function: fn }));
}

/**
 * Convert TOOL_SCHEMAS into the Responses-protocol flat shape:
 *   { type: "function", name, description, parameters }
 * Used by `foundryClient.invokeAgent` for Foundry hosted agents.
 */
export function toolsForResponses(): ResponsesFunctionTool[] {
  return TOOL_SCHEMAS.map((fn) => ({
    type: "function" as const,
    name: fn.name,
    description: fn.description,
    parameters: fn.parameters,
  }));
}
