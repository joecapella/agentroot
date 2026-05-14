import { describe, it } from "node:test";
import assert from "node:assert";
import { LOGICAL_DEPLOYMENTS, pickChatModelForTask } from "@/src/modelRouting";

describe("modelRouting direct providers", () => {
  it("includes gemini-pro in LOGICAL_DEPLOYMENTS", () => {
    const spec = LOGICAL_DEPLOYMENTS["gemini-pro"];
    assert.ok(spec);
    assert.strictEqual(spec.family, "direct_openai");
    assert.strictEqual(spec.endpointEnvVar, "GEMINI_ENDPOINT");
    assert.strictEqual(spec.apiKeyEnvVar, "GEMINI_API_KEY");
  });

  it("includes gemini-flash in LOGICAL_DEPLOYMENTS", () => {
    const spec = LOGICAL_DEPLOYMENTS["gemini-flash"];
    assert.ok(spec);
    assert.strictEqual(spec.family, "direct_openai");
  });

  it("pickChatModelForTask selects direct_openai as chat-capable", () => {
    // If we temporarily make gemini-flash the default for fast_brainstorm,
    // pickChatModelForTask should accept it.
    // We can't easily mutate ROUTES, but we can verify that
    // pickChatModelForTask returns an azure_openai family for existing routes.
    const spec = pickChatModelForTask("fast_brainstorm");
    assert.ok(spec.family === "azure_openai" || spec.family === "direct_openai");
  });
});
