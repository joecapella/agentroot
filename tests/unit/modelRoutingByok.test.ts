import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  LOGICAL_DEPLOYMENTS,
  deploymentForModel,
  pickByokChatModel,
  pickByokImageModel,
  resolveAvailable,
} from "@/src/modelRouting";

describe("modelRouting BYOK helpers", () => {
  it("prefers OpenAI BYOK and uses mini for fast_brainstorm", () => {
    const spec = pickByokChatModel({ openai: "sk-openai" }, "fast_brainstorm");
    assert.equal(spec?.deployment, LOGICAL_DEPLOYMENTS["byok-openai-mini"].deployment);
  });

  it("falls through to Anthropic and Gemini keys", () => {
    const anthropic = pickByokChatModel({ anthropic: "sk-anth" }, "general_chat");
    assert.equal(anthropic?.deployment, LOGICAL_DEPLOYMENTS["byok-anthropic"].deployment);
    const gemini = pickByokChatModel({ gemini: "sk-gem" }, "general_chat");
    assert.equal(gemini?.deployment, LOGICAL_DEPLOYMENTS["byok-gemini"].deployment);
  });

  it("returns null when no BYOK keys supplied", () => {
    assert.equal(pickByokChatModel({}, "general_chat"), null);
    assert.equal(pickByokImageModel(null), null);
  });

  it("selects BYOK image model only for OpenAI keys", () => {
    const spec = pickByokImageModel({ openai: "sk-openai" });
    assert.equal(spec?.deployment, LOGICAL_DEPLOYMENTS["byok-openai-image"].deployment);
  });

  it("resolves deployment overrides via env", () => {
    const envKey = "MODEL_DEPLOYMENT_gpt_5_5";
    const saved = process.env[envKey];
    process.env[envKey] = "override-deployment";
    assert.equal(deploymentForModel("gpt-5.5"), "override-deployment");
    if (saved === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = saved;
    }
  });

  it("returns null for unavailable deployments", () => {
    assert.equal(resolveAvailable("claude-opus-4-7"), null);
    assert.ok(resolveAvailable("gpt-5.5"));
  });
});
