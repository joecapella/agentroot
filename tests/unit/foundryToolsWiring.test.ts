/**
 * Tests for tool schema converters and Foundry request guardrails.
 *
 * Chat Completions providers still need wrapped tool schemas. Responses-flat
 * conversion is kept for future/non-hosted Responses surfaces, but Microsoft
 * Foundry hosted agents currently reject top-level `tools`, so invokeAgent must
 * not attach them by default.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TOOL_SCHEMAS,
  toolsForChatCompletions,
  toolsForResponses,
} from "@/src/server/toolsSchema";

describe("toolsSchema converters", () => {
  it("Responses shape is flat (type + name + description + parameters)", () => {
    const tools = toolsForResponses();
    assert.equal(tools.length, TOOL_SCHEMAS.length);
    for (const t of tools) {
      assert.equal(t.type, "function");
      assert.equal(typeof t.name, "string");
      assert.equal(typeof t.description, "string");
      assert.equal(t.parameters.type, "object");
      // Responses surface MUST NOT have the `function` wrapper — verifying
      // we don't accidentally drift back to the Chat Completions shape.
      assert.equal((t as unknown as { function?: unknown }).function, undefined);
    }
  });

  it("Chat Completions shape is wrapped ({ type, function: { ... } })", () => {
    const tools = toolsForChatCompletions();
    assert.equal(tools.length, TOOL_SCHEMAS.length);
    for (const t of tools) {
      assert.equal(t.type, "function");
      assert.equal(typeof t.function.name, "string");
      assert.equal(t.function.parameters.type, "object");
    }
  });

  it("includes the destructive tools that need approval", () => {
    const names = TOOL_SCHEMAS.map((t) => t.name);
    for (const required of ["write_file", "run_command", "search_replace", "generate_image"]) {
      assert.ok(names.includes(required), `TOOL_SCHEMAS missing required tool ${required}`);
    }
  });

  it("every Responses tool round-trips JSON.stringify cleanly", () => {
    // Foundry needs serialisable schemas — no functions / classes / cycles.
    for (const t of toolsForResponses()) {
      const round = JSON.parse(JSON.stringify(t));
      assert.deepEqual(round.parameters, t.parameters);
    }
  });
});

describe("ResponsesUsage extraction", () => {
  it("extractUsage handles input_tokens/output_tokens (Responses-native)", async () => {
    const { extractUsage } = await import("@/src/foundryClient");
    const u = extractUsage({
      id: "caresp_x",
      object: "response",
      status: "completed",
      error: null,
      output: [],
      usage: { input_tokens: 1200, output_tokens: 340 },
    });
    assert.equal(u.promptTokens, 1200);
    assert.equal(u.completionTokens, 340);
  });

  it("extractUsage falls back to prompt_tokens/completion_tokens (legacy)", async () => {
    const { extractUsage } = await import("@/src/foundryClient");
    const u = extractUsage({
      id: "caresp_x",
      object: "response",
      status: "completed",
      error: null,
      output: [],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    assert.equal(u.promptTokens, 100);
    assert.equal(u.completionTokens, 50);
  });

  it("extractUsage returns 0/0 when usage is missing", async () => {
    const { extractUsage } = await import("@/src/foundryClient");
    const u = extractUsage({
      id: "caresp_x",
      object: "response",
      status: "completed",
      error: null,
      output: [],
    });
    assert.equal(u.promptTokens, 0);
    assert.equal(u.completionTokens, 0);
  });
});

describe("isValidResponseId", () => {
  it("accepts caresp_ ids (Foundry hosted-agent responses)", async () => {
    const { isValidResponseId } = await import("@/src/foundryClient");
    assert.equal(isValidResponseId("caresp_abc123XYZ"), true);
  });

  it("accepts resp_ ids (upstream OpenAI)", async () => {
    const { isValidResponseId } = await import("@/src/foundryClient");
    assert.equal(isValidResponseId("resp_abc123"), true);
  });

  it("rejects bare hex session ids", async () => {
    const { isValidResponseId } = await import("@/src/foundryClient");
    // Foundry agent_session_id values are unprefixed — they MUST be rejected
    // because passing them as previous_response_id produces HTTP 500.
    assert.equal(isValidResponseId("a1b2c3d4e5f6"), false);
  });

  it("rejects undefined / null / empty", async () => {
    const { isValidResponseId } = await import("@/src/foundryClient");
    assert.equal(isValidResponseId(undefined), false);
    assert.equal(isValidResponseId(null), false);
    assert.equal(isValidResponseId(""), false);
  });
});
