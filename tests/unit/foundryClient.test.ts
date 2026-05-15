import { describe, it, before, after, afterEach } from "node:test";
import { strict as assert } from "node:assert";

import {
  __setTestToken,
  generateImages,
  invokeAgent,
  projectEndpoint,
  responsesEndpointFor,
} from "@/src/foundryClient";

const realFetch = globalThis.fetch;

describe("foundryClient helpers", () => {
  const savedEndpoint = process.env.AZURE_AI_PROJECT_ENDPOINT;
  const savedAllowTools = process.env.FOUNDRY_RESPONSES_ALLOW_TOOLS;

  before(() => {
    process.env.AZURE_AI_PROJECT_ENDPOINT =
      process.env.AZURE_AI_PROJECT_ENDPOINT ?? "https://example.invalid/api/projects/test";
    __setTestToken("test-token");
  });

  after(() => {
    process.env.AZURE_AI_PROJECT_ENDPOINT = savedEndpoint;
    process.env.FOUNDRY_RESPONSES_ALLOW_TOOLS = savedAllowTools;
    __setTestToken(null);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("throws when project endpoint is missing", () => {
    const saved = process.env.AZURE_AI_PROJECT_ENDPOINT;
    delete process.env.AZURE_AI_PROJECT_ENDPOINT;
    assert.throws(() => projectEndpoint(), /AZURE_AI_PROJECT_ENDPOINT not set/);
    process.env.AZURE_AI_PROJECT_ENDPOINT = saved;
  });

  it("builds responses endpoint URLs", () => {
    const url = responsesEndpointFor("Cofounder Agent");
    assert.ok(url.includes("/agents/Cofounder%20Agent/"));
    assert.ok(url.includes("api-version=2025-11-15-preview"));
  });

  it("invokes agents with tools when explicitly allowed", async () => {
    process.env.FOUNDRY_RESPONSES_ALLOW_TOOLS = "true";
    let lastBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
      lastBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      return new Response(
        JSON.stringify({
          id: "caresp_1",
          object: "response",
          status: "completed",
          error: null,
          output: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    await invokeAgent(
      "TestAgent",
      {
        input: "hi",
        tools: [{ type: "function", name: "read_file", parameters: { type: "object", properties: {} } }],
      },
      { attachTools: true },
    );

    const body = lastBody as { tools?: unknown[]; tool_choice?: string } | null;
    assert.ok(Array.isArray(body?.tools));
    assert.equal(body?.tool_choice, "auto");
  });

  it("generates images with BYOK OpenAI key", async () => {
    let calls = 0;
    let lastAuth: string | null = null;
    globalThis.fetch = (async (_input, init) => {
      calls += 1;
      const headers = init?.headers as Headers | Record<string, string> | undefined;
      lastAuth = headers instanceof Headers ? headers.get("Authorization") : headers?.Authorization ?? null;
      return new Response(
        JSON.stringify({ data: [{ b64_json: `img-${calls}` }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const result = await generateImages({
      prompt: "hello",
      n: 2,
      byokOpenAIKey: "sk-test",
    });

    assert.equal(calls, 2);
    assert.equal(lastAuth, "Bearer sk-test");
    assert.deepEqual(result.images, ["img-1", "img-2"]);
    assert.equal(result.droppedCount, 0);
  });
});
