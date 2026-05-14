import { describe, it } from "node:test";
import assert from "node:assert";
import { convertInputToMessages, convertCompletionToEnvelope } from "@/src/server/directProviders";

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
});
