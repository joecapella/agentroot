/**
 * Pure-unit tests for foundryClient + modelRouting helpers — no DB, no
 * network. These guard the regex tightening (Bug-7), response-id validation
 * (Bug-5), endpoint mismatch fail-fast, and chat-only routing (Bug-9).
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

// Set the env var before importing foundryClient (the module reads it at
// call time, but we still want a sensible value for the fallback test).
process.env.AZURE_AI_PROJECT_ENDPOINT =
  process.env.AZURE_AI_PROJECT_ENDPOINT ??
  "https://example.invalid/api/projects/test";

import { isValidResponseId, resolveEndpoint, flattenEnvelope } from "@/src/foundryClient";
import {
  inferTaskKind,
  LOGICAL_DEPLOYMENTS,
  pickChatModelForTask,
} from "@/src/modelRouting";
import { openExternalUrl } from "@/src/server/openExternalUrl";

describe("isValidResponseId (Bug-5)", () => {
  it("accepts caresp_ and resp_ prefixes", () => {
    assert.equal(isValidResponseId("caresp_abc123"), true);
    assert.equal(isValidResponseId("resp_XYZ-09"), true);
  });
  it("rejects empty, null, undefined", () => {
    assert.equal(isValidResponseId(undefined), false);
    assert.equal(isValidResponseId(null), false);
    assert.equal(isValidResponseId(""), false);
  });
  it("rejects hex session ids", () => {
    assert.equal(isValidResponseId("deadbeefcafe"), false);
    assert.equal(isValidResponseId("abc_NOT_RESP_123"), false);
  });
});

describe("resolveEndpoint (agent-name fail-fast)", () => {
  const ENV_KEY = "AGENT_TESTAGENT_RESPONSES_ENDPOINT";
  const SAVED = process.env[ENV_KEY];

  it("uses direct env URL when names match", () => {
    process.env[ENV_KEY] =
      "https://example.invalid/api/projects/test/agents/TestAgent/endpoint/protocols/openai/responses?api-version=2025-11-15-preview";
    const url = resolveEndpoint("TestAgent");
    assert.ok(url.includes("/agents/TestAgent/"));
    process.env[ENV_KEY] = SAVED;
  });

  it("throws on agent-name mismatch (the 2026-05-12 502 root cause)", () => {
    process.env[ENV_KEY] =
      "https://example.invalid/api/projects/test/agents/WrongName/endpoint/protocols/openai/responses?api-version=2025-11-15-preview";
    assert.throws(
      () => resolveEndpoint("TestAgent"),
      /agent_endpoint_name_mismatch/
    );
    process.env[ENV_KEY] = SAVED;
  });

  it("falls back to constructed URL when no direct env var set", () => {
    delete process.env[ENV_KEY];
    const url = resolveEndpoint("TestAgent");
    assert.ok(url.includes("/agents/TestAgent/"));
    process.env[ENV_KEY] = SAVED;
  });
});

describe("inferTaskKind regex tightening (Bug-7)", () => {
  it("does NOT route plain English with 'hook' to code", () => {
    const k = inferTaskKind("I need a hook to remember to call my mom");
    assert.notEqual(k, "code_repo");
    assert.notEqual(k, "code_file");
  });
  it("does NOT route 'render my opinion' to visual", () => {
    const k = inferTaskKind("render my opinion about that proposal");
    assert.notEqual(k, "visual");
  });
  it("does NOT route 'component of the plan' to code", () => {
    const k = inferTaskKind("the marketing component of the plan");
    assert.notEqual(k, "code_repo");
    assert.notEqual(k, "code_file");
  });
  it("DOES route explicit image generation to visual", () => {
    assert.equal(
      inferTaskKind("generate a hero image for the landing page"),
      "visual"
    );
    assert.equal(inferTaskKind("draw an illustration of a fox"), "visual");
  });
  it("DOES route explicit code asks to code", () => {
    const k = inferTaskKind("refactor this typescript file");
    assert.ok(k === "code_repo" || k === "code_file");
    assert.equal(
      inferTaskKind("fix this bug in the react component"),
      "code_file"
    );
  });
  it("DOES route OCR-style asks to vision", () => {
    assert.equal(inferTaskKind("what do you see in this image"), "vision");
    assert.equal(inferTaskKind("ocr this screenshot"), "vision");
  });
});

describe("pickChatModelForTask (Bug-9)", () => {
  it("never returns a non-chat family for any TaskKind, including visual", () => {
    for (const t of [
      "deep_planning",
      "general_chat",
      "fast_brainstorm",
      "code_repo",
      "code_file",
      "brand_strategy",
      "copywriting",
      "personal_ops",
      "vision",
      "visual",
    ] as const) {
      const spec = pickChatModelForTask(t);
      assert.equal(
        spec.family,
        "azure_openai",
        `task ${t} resolved to non-chat family ${spec.family} (${spec.deployment})`
      );
    }
  });
});

describe("openExternalUrl", () => {
  it("resolves only after the opener exits successfully", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const result = await openExternalUrl("https://example.com", {
      platform: "linux",
      spawn: (cmd, args) => {
        calls.push({ cmd, args });
        return fakeChild({ closeCode: 0 });
      },
    });
    assert.equal(result.cmd, "xdg-open");
    assert.deepEqual(calls, [{ cmd: "xdg-open", args: ["https://example.com"] }]);
  });

  it("rejects and does not report completion when spawn emits error", async () => {
    await assert.rejects(
      () =>
        openExternalUrl("https://example.com", {
          platform: "linux",
          spawn: () => fakeChild({ error: new Error("missing opener") }),
        }),
      /missing opener/
    );
  });

  it("rejects and does not report completion when opener exits non-zero", async () => {
    await assert.rejects(
      () =>
        openExternalUrl("https://example.com", {
          platform: "linux",
          spawn: () => fakeChild({ closeCode: 3 }),
        }),
      /exited with code 3/
    );
  });
});

describe("flattenEnvelope multi-image", () => {
  it("collects all completed image_generation_call results as JSON array", () => {
    const env = {
      id: "caresp_MULTI",
      object: "response" as const,
      status: "completed" as const,
      error: null,
      output: [
        { type: "message", id: "m1", role: "assistant" as const, status: "completed" as const, content: [{ type: "output_text", text: "Here are 3 mockups." }] },
        { type: "image_generation_call", id: "img1", status: "completed" as const, result: "base64_1" },
        { type: "image_generation_call", id: "img2", status: "completed" as const, result: "base64_2" },
        { type: "image_generation_call", id: "img3", status: "in_progress" as const },
        { type: "image_generation_call", id: "img4", status: "completed" as const, result: "base64_4" },
      ],
    };
    const flat = flattenEnvelope(env);
    assert.equal(flat.text, "Here are 3 mockups.");
    assert.ok(flat.imageBase64);
    const parsed = JSON.parse(flat.imageBase64!);
    assert.deepEqual(parsed, ["base64_1", "base64_2", "base64_4"]);
  });

  it("returns a single image as raw string (not JSON array)", () => {
    const env = {
      id: "caresp_SINGLE",
      object: "response" as const,
      status: "completed" as const,
      error: null,
      output: [
        { type: "message", id: "m1", role: "assistant" as const, status: "completed" as const, content: [{ type: "output_text", text: "Done." }] },
        { type: "image_generation_call", id: "img1", status: "completed" as const, result: "base64_only" },
      ],
    };
    const flat = flattenEnvelope(env);
    assert.equal(flat.imageBase64, "base64_only");
  });

  it("returns null imageBase64 when no images", () => {
    const env = {
      id: "caresp_NONE",
      object: "response" as const,
      status: "completed" as const,
      error: null,
      output: [
        { type: "message", id: "m1", role: "assistant" as const, status: "completed" as const, content: [{ type: "output_text", text: "No images." }] },
      ],
    };
    const flat = flattenEnvelope(env);
    assert.equal(flat.imageBase64, null);
  });
});

describe("azure.yaml deployment coverage", () => {
  it("declares every available azure_openai deployment the router may select", () => {
    // Only azure_openai-family deployments live in azure.yaml — direct
    // providers (Gemini, Ollama, OpenRouter) are out-of-band by design.
    const yaml = readFileSync("azure.yaml", "utf-8");
    const missing = Object.values(LOGICAL_DEPLOYMENTS)
      .filter((spec) => !spec.unavailable && spec.family === "azure_openai")
      .map((spec) => spec.deployment)
      .filter((deployment) => !yaml.includes(`name: ${deployment}`));

    assert.deepEqual(missing, []);
  });
});

function fakeChild(result: { closeCode?: number; error?: Error }) {
  const handlers = new Map<string, (arg: Error | number | null) => void>();
  const child = {
    once(event: "error" | "close", handler: (arg: Error | number | null) => void) {
      handlers.set(event, handler);
      return child;
    },
    unref() {
      return child;
    },
  };

  queueMicrotask(() => {
    if (result.error) {
      handlers.get("error")?.(result.error);
      return;
    }
    handlers.get("close")?.(result.closeCode ?? 0);
  });

  return child;
}
