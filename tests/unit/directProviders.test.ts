import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import {
  convertCompletionToEnvelope,
  convertInputToMessages,
  invokeDirectAnthropic,
  invokeDirectOpenAI,
} from "@/src/server/directProviders";
import type { DeploymentSpec } from "@/src/modelRouting";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("directProviders", () => {
  describe("convertInputToMessages", () => {
    it("converts string input to a single user message", () => {
      const msgs = convertInputToMessages("hello", undefined);
      assert.strictEqual(msgs.length, 1);
      assert.strictEqual(msgs[0].role, "user");
      assert.strictEqual(msgs[0].content, "hello");
    });

    it("prepends instructions as system message", () => {
      const msgs = convertInputToMessages("hello", "Be helpful");
      assert.strictEqual(msgs.length, 2);
      assert.strictEqual(msgs[0].role, "system");
      assert.strictEqual(msgs[0].content, "Be helpful");
      assert.strictEqual(msgs[1].role, "user");
    });

    it("converts developer role to system", () => {
      const msgs = convertInputToMessages([{ role: "developer" as const, content: "sys" }], undefined);
      assert.strictEqual(msgs[0].role, "system");
      assert.strictEqual(msgs[0].content, "sys");
    });

    it("converts function_call_output to tool role", () => {
      const msgs = convertInputToMessages([
        { type: "function_call_output" as const, call_id: "call_1", output: "42" },
      ], undefined);
      assert.strictEqual(msgs[0].role, "tool");
      assert.strictEqual(msgs[0].tool_call_id, "call_1");
      assert.strictEqual(msgs[0].content, "42");
    });

    it("converts multimodal content parts", () => {
      const msgs = convertInputToMessages([
        {
          role: "user" as const,
          content: [
            { type: "input_text" as const, text: "look at this" },
            { type: "input_image" as const, image_url: { url: "data:image/png;base64,abc" } },
          ],
        },
      ], undefined);
      const parts = msgs[0].content as Array<{ type: string }>;
      assert.strictEqual(parts.length, 2);
      assert.strictEqual(parts[0].type, "text");
      assert.strictEqual(parts[1].type, "image_url");
    });
  });

  describe("convertCompletionToEnvelope", () => {
    it("converts simple text response", () => {
      const env = convertCompletionToEnvelope({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "gemini-pro",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello world" },
            finish_reason: "stop",
          },
        ],
      });
      assert.strictEqual(env.status, "completed");
      assert.strictEqual(env.error, null);
      assert.strictEqual(env.output.length, 1);
      const msg = env.output[0] as { type: string; content: Array<{ type: string; text: string }> };
      assert.strictEqual(msg.type, "message");
      assert.strictEqual(msg.content[0].text, "Hello world");
    });

    it("converts tool_calls to function_call items", () => {
      const env = convertCompletionToEnvelope({
        id: "chatcmpl-2",
        object: "chat.completion",
        created: 1,
        model: "gemini-pro",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_abc",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path":"README.md"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
      assert.strictEqual(env.output.length, 1);
      const fc = env.output[0] as { type: string; call_id: string; name: string; arguments: string };
      assert.strictEqual(fc.type, "function_call");
      assert.strictEqual(fc.call_id, "call_abc");
      assert.strictEqual(fc.name, "read_file");
      assert.strictEqual(fc.arguments, '{"path":"README.md"}');
    });

    it("returns failed envelope when no choices", () => {
      const env = convertCompletionToEnvelope({
        id: "chatcmpl-3",
        object: "chat.completion",
        created: 1,
        model: "gemini-pro",
        choices: [],
      });
      assert.strictEqual(env.status, "failed");
      assert.ok(env.error);
    });
  });

  describe("invokeDirectOpenAI", () => {
    it("attaches tool schemas by default and returns a Responses envelope", async () => {
      let lastBody: Record<string, unknown> | null = null;
      let lastAuth: string | null = null;
      globalThis.fetch = (async (input, init) => {
        lastBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
        const headers = init?.headers as Record<string, string> | Headers | undefined;
        lastAuth = headers instanceof Headers ? headers.get("Authorization") : headers?.Authorization ?? null;
        return new Response(
          JSON.stringify({
            id: "chatcmpl-1",
            object: "chat.completion",
            created: 1,
            model: "gpt-4o",
            choices: [
              { index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof globalThis.fetch;

      const spec: DeploymentSpec = {
        deployment: "gpt-4o",
        family: "direct_openai",
        baseUrl: "https://example.invalid",
      };
      const env = await invokeDirectOpenAI(
        spec,
        { input: "hi", instructions: "Be helpful" },
        { userKey: "key-123" },
      );

      assert.equal(lastAuth, "Bearer key-123");
      const body = lastBody as { tools?: unknown[] } | null;
      assert.ok(Array.isArray(body?.tools));
      assert.equal(env.status, "completed");
      assert.equal(env.output[0]?.type, "message");
    });

    it("throws when provider returns an error object", async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            id: "chatcmpl-err",
            object: "chat.completion",
            created: 1,
            model: "gpt-4o",
            choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
            error: { message: "bad request", code: "bad_request" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof globalThis.fetch;

      const spec: DeploymentSpec = {
        deployment: "gpt-4o",
        family: "direct_openai",
        baseUrl: "https://example.invalid",
      };

      await assert.rejects(
        () => invokeDirectOpenAI(spec, { input: "hi" }),
        /Direct provider error: bad_request/,
      );
    });
  });

  describe("invokeDirectAnthropic", () => {
    it("converts system prompts and tool calls into Responses envelope", async () => {
      let lastBody: Record<string, unknown> | null = null;
      globalThis.fetch = (async (_input, init) => {
        lastBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
        return new Response(
          JSON.stringify({
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-3-5",
            content: [
              { type: "text", text: "Hello there" },
              { type: "tool_use", id: "tool-1", name: "read_file", input: { path: "README.md" } },
            ],
            stop_reason: "end",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof globalThis.fetch;

      const spec: DeploymentSpec = {
        deployment: "claude-3-5-sonnet-20241022",
        family: "direct_anthropic",
        baseUrl: "https://api.anthropic.com/v1",
      };
      const env = await invokeDirectAnthropic(
        spec,
        {
          input: [
            { role: "developer", content: "System A" },
            { role: "system", content: "System B" } as unknown as { role: "developer"; content: string },
            { type: "function_call_output", call_id: "call-1", output: "tool ok" },
            { role: "user", content: "Hello" },
          ],
          instructions: "Fallback system",
        },
        { userKey: "anthropic-key" },
      );

      const body = lastBody as { system?: string; messages?: Array<{ role: string; content: string }> } | null;
      assert.equal(body?.system, "System A\n\nSystem B");
      const messages = body?.messages ?? [];
      assert.ok(messages[0].content.includes("tool_result"));
      assert.equal(env.output[0].type, "message");
      const toolCall = env.output.find((item) => item.type === "function_call");
      assert.ok(toolCall);
    });

    it("requires an API key", async () => {
      const spec: DeploymentSpec = {
        deployment: "claude-3-5-sonnet-20241022",
        family: "direct_anthropic",
        baseUrl: "https://api.anthropic.com/v1",
      };
      await assert.rejects(
        () => invokeDirectAnthropic(spec, { input: "hi" }),
        /anthropic_missing_api_key/,
      );
    });
  });
});
