/**
 * /api/chat behaviour tests.
 *
 * Strategy: we intercept `globalThis.fetch` (the underlying transport used by
 * `invokeAgent` → Foundry) so we never touch the network. This is ESM-safe
 * (the older `require.cache` patching was silently broken under tsx/ESM).
 *
 * Covered:
 *  - Pure helpers: extractAndStripFacts, titleFromFirstMessage indirectly via SSE
 *  - persona/task prefix is sent to Foundry but NOT persisted in DB user msg
 *  - previousResponseId is persisted on success
 *  - previousResponseId is NOT advanced for non-Responses ids
 *  - usage tokens flow into TokenUsage rows
 *  - top-level tools field is NOT sent to Foundry hosted agents (400 guard)
 *  - oversized image is dropped but text turn still completes
 */
import { strict as assert } from "node:assert";
import { describe, it, before, after, beforeEach } from "node:test";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";

process.env.AZURE_AI_PROJECT_ENDPOINT =
  "https://example.invalid/api/projects/test";
process.env.COFOUNDER_AGENT_NAME = "TestAgent";
process.env.DATABASE_URL = "file:./test.db";
process.env.AGENT_TESTAGENT_RESPONSES_ENDPOINT =
  "https://example.invalid/api/projects/test/agents/TestAgent/endpoint/protocols/openai/responses?api-version=2025-11-15-preview";
process.env.AZURE_OPENAI_ENDPOINT = "https://example.invalid/openai";
process.env.AZURE_AI_IMAGE_DEPLOYMENT = "test-image-deployment";

type Envelope = {
  id: string;
  object: "response";
  status: "completed" | "failed";
  error: { code: string; message: string } | null;
  output: Array<{ type: string; [k: string]: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

interface FetchCall {
  url: string;
  body: Record<string, unknown> | null;
  authorization?: string | null;
}

let nextEnvelope: Envelope | null = null;
let nextFetchStatus = 200;
let nextImageResponse: { status: number; body: unknown } = { status: 200, body: { data: [] } };
const fetchCalls: FetchCall[] = [];
let realFetch: typeof globalThis.fetch;

let prisma: typeof import("@/src/prisma").prisma;
let SERVER_USER_ID = "";
let chatRoute: typeof import("@/app/api/chat/route");

function makeReq(
  url: string,
  init: { method?: string; body?: unknown } = {},
): NextRequest {
  const headers = new Headers();
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: init.method ?? "POST",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

let myConvId = "";

async function readSSE(
  res: Response,
): Promise<{ done: Record<string, unknown>; events: Array<{ event: string; data: Record<string, unknown> }>; sawError: { code: string } | null }> {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  let donePayload: Record<string, unknown> = {};
  let sawError: { code: string } | null = null;
  if (!res.body) return { done: donePayload, events, sawError };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const eventMatch = chunk.match(/^event: (\w+)$/m);
      const dataMatch = chunk.match(/^data: (.+)$/m);
      if (!eventMatch || !dataMatch) continue;
      const event = eventMatch[1];
      const data = JSON.parse(dataMatch[1]) as Record<string, unknown>;
      events.push({ event, data });
      if (event === "done") donePayload = data;
      if (event === "error") sawError = { code: String(data.code) };
    }
  }
  return { done: donePayload, events, sawError };
}

before(async () => {
  const migrated = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env },
  });
  assert.equal(migrated.status, 0);

  // Intercept fetch BEFORE we import anything that captures `globalThis.fetch`.
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();

    // Foundry agent endpoint — return the canned envelope.
    if (url.includes("/agents/TestAgent/endpoint/protocols/openai/responses")) {
      let body: Record<string, unknown> | null = null;
      try {
        body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      } catch {
        body = null;
      }
      fetchCalls.push({ url, body, authorization: init?.headers instanceof Headers ? init.headers.get("authorization") : (init?.headers as Record<string, string> | undefined)?.Authorization });
      if (!nextEnvelope) {
        return new Response(JSON.stringify({ error: { code: "no_envelope", message: "test misconfigured" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(nextEnvelope), {
        status: nextFetchStatus,
        headers: { "Content-Type": "application/json", "x-ms-request-id": "test-req-id" },
      });
    }

    // Image generation endpoint.
    if (url.includes("/images/generations")) {
      let body: Record<string, unknown> | null = null;
      try {
        body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      } catch {
        body = null;
      }
      fetchCalls.push({ url, body, authorization: init?.headers instanceof Headers ? init.headers.get("authorization") : (init?.headers as Record<string, string> | undefined)?.Authorization });
      return new Response(JSON.stringify(nextImageResponse.body), {
        status: nextImageResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Anything else (Azure token endpoint etc.) — fall through to real fetch.
    return realFetch(input, init);
  }) as typeof globalThis.fetch;

  // Bypass DefaultAzureCredential so token fetches don't hit the network.
  const fc = await import("@/src/foundryClient");
  fc.__setTestToken("test-token");

  const prismaModule = await import("@/src/prisma");
  const authModule = await import("@/src/server/auth");
  prisma = prismaModule.prisma;
  SERVER_USER_ID = authModule.SERVER_USER_ID;
  chatRoute = await import("@/app/api/chat/route");

  await prisma.tokenUsage.deleteMany({});
  await prisma.fact.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
});

beforeEach(async () => {
  nextEnvelope = null;
  nextFetchStatus = 200;
  nextImageResponse = { status: 200, body: { data: [] } };
  fetchCalls.length = 0;
  await prisma.tokenUsage.deleteMany({});
  await prisma.fact.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  const c = await prisma.conversation.create({
    data: { userId: SERVER_USER_ID, title: "t" },
  });
  myConvId = c.id;
});

after(async () => {
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
});

function envText(id: string, text: string, usage?: { input_tokens: number; output_tokens: number }): Envelope {
  return {
    id,
    object: "response",
    status: "completed",
    error: null,
    output: [
      {
        type: "message",
        id: `${id}-msg`,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text }],
      },
    ],
    usage,
  };
}

describe("chat route — single-turn happy path (Bug-1/2/3 wiring)", () => {
  it("persists assistant message, advances previousResponseId, records real tokens", async () => {
    nextEnvelope = envText("caresp_abc123", "Hello back.", { input_tokens: 50, output_tokens: 20 });

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: {
          conversationId: myConvId,
          message: "hello",
          reasoningProfile: "balanced",
          toolsMode: "off",
        },
      }),
    );
    assert.equal(r.status, 200);
    const { done, sawError } = await readSSE(r);
    assert.equal(sawError, null);
    assert.equal(done.taskKind, "general_chat");

    // previousResponseId was persisted (Bug-2 fix).
    const conv = await prisma.conversation.findUnique({ where: { id: myConvId } });
    assert.equal(conv?.previousResponseId, "caresp_abc123");

    // Real usage rows exist (Bug-3 fix), NOT char-length heuristics.
    const usageRows = await prisma.tokenUsage.findMany({ where: { conversationId: myConvId } });
    assert.equal(usageRows.length, 1);
    assert.equal(usageRows[0].promptTokens, 50);
    assert.equal(usageRows[0].completionTokens, 20);
  });

  it("does NOT advance previousResponseId for non-Responses envelope ids (Bug-5)", async () => {
    // Foundry agent_session_id values are unprefixed; passing them back
    // produces upstream HTTP 500 — we must reject them.
    nextEnvelope = envText("bare-hex-not-a-resp-id", "ok");

    await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "hi", toolsMode: "off" },
      }),
    );
    const conv = await prisma.conversation.findUnique({ where: { id: myConvId } });
    assert.equal(conv?.previousResponseId, null);
  });

  it("persists the raw user text, not the [persona:..][task:..] routing prefix (Bug-9)", async () => {
    nextEnvelope = envText("caresp_p1", "ok");

    await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "what's up", toolsMode: "off" },
      }),
    );
    const msgs = await prisma.message.findMany({ where: { conversationId: myConvId, sender: "user" } });
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].text, "what's up");
    assert.doesNotMatch(msgs[0].text ?? "", /\[persona:/);
  });
});

describe("chat route — Foundry request body wiring", () => {
  it("forwards the persona/task prefix INSIDE the model input (not stripped)", async () => {
    nextEnvelope = envText("caresp_p2", "ok");

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: {
          conversationId: myConvId,
          message: "debug this typescript bug",
          reasoningProfile: "deep",
          toolsMode: "off",
        },
      }),
    );
    const { sawError } = await readSSE(r);
    assert.equal(sawError, null, `chat returned error: ${sawError?.code}`);
    assert.equal(fetchCalls.length, 1);
    const sentInput = fetchCalls[0].body?.input;
    assert.equal(typeof sentInput, "string");
    // The persona/task routing prefix must reach Foundry. On a fresh
    // conversation we additionally wrap the input in a `[SYSTEM_OVERRIDE]`
    // block carrying the latest persona prompt + memory preamble (the
    // `instructions` field is rejected by Foundry hosted agents). The
    // routing prefix must appear AFTER the override block.
    assert.match(
      String(sentInput),
      /\[persona:code_assistant\] \[task:code_repo\] debug this typescript bug/,
    );
  });

  it("does NOT send the Responses `instructions` field to Foundry (rejected by hosted agents)", async () => {
    nextEnvelope = envText("caresp_noinstr", "ok");
    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: {
          conversationId: myConvId,
          message: "hello",
          toolsMode: "off",
        },
      }),
    );
    await readSSE(r);
    const foundryCall = fetchCalls.find((c) =>
      c.url.includes("/agents/TestAgent/"),
    );
    assert.ok(foundryCall);
    assert.equal(
      Object.prototype.hasOwnProperty.call(foundryCall!.body ?? {}, "instructions"),
      false,
      "Foundry request must NOT carry top-level `instructions`",
    );
  });

  it("forwards previousResponseId on the SECOND turn (chain continuation)", async () => {
    nextEnvelope = envText("caresp_first", "first");
    const r1 = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "first", toolsMode: "off" },
      }),
    );
    await readSSE(r1);

    nextEnvelope = envText("caresp_second", "second");
    fetchCalls.length = 0;
    const r2 = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "second", toolsMode: "off" },
      }),
    );
    await readSSE(r2);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].body?.previous_response_id, "caresp_first");
  });

  it("does not send top-level tools to Foundry hosted agents", async () => {
    nextEnvelope = envText("caresp_no_tools", "ok");

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "hello", toolsMode: "ask" },
      }),
    );
    const { sawError } = await readSSE(r);
    assert.equal(sawError, null, `chat returned error: ${sawError?.code}`);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].body?.tools, undefined);
    assert.equal(fetchCalls[0].body?.tool_choice, undefined);
  });

  it("routes explicit visual requests through direct image generation", async () => {
    nextEnvelope = envText("caresp_visual", "Here is the image.");
    nextImageResponse = { status: 200, body: { data: [{ b64_json: "image_b64" }] } };

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: {
          conversationId: myConvId,
          message: "generate an image of a friendly beetle",
          toolsMode: "allowed",
          imageQuality: "high",
          imageSize: "1024x1536",
        },
      }),
    );
    const { sawError } = await readSSE(r);
    assert.equal(sawError, null, `chat returned error: ${sawError?.code}`);

    const agentCalls = fetchCalls.filter((c) => c.url.includes("/agents/TestAgent/"));
    const imageCalls = fetchCalls.filter((c) => c.url.includes("/images/generations"));
    // Explicit visual tasks SKIP the chat model entirely — gpt-image-2-1
    // is the source of truth for the response, so the chat invoke would
    // be wasted tokens and (with the current container's baked prompt)
    // would emit a misleading "I can't generate images" refusal that
    // bleeds into the UI alongside the actual image.
    assert.equal(agentCalls.length, 0);
    assert.equal(imageCalls.length, 1);
    assert.equal(imageCalls[0].body?.prompt, "generate an image of a friendly beetle");
    assert.equal(imageCalls[0].body?.quality, "high");
    assert.equal(imageCalls[0].body?.size, "1024x1536");

    const msgs = await prisma.message.findMany({ where: { conversationId: myConvId, sender: "assistant" } });
    assert.equal(msgs.at(-1)?.imageBase64, "image_b64");
    // On a successful visual generation we drop the (likely-stale) chat
    // model's text and let the image speak. The assistant row may have
    // null text, that's fine.
    assert.ok(
      msgs.at(-1)?.text === null || msgs.at(-1)?.text === "",
      "visual-task assistant message should have empty/null text on success",
    );
  });
});

describe("chat route — fact extraction", () => {
  it("extracts MEMORY_FACT markers and strips them from assistant text", async () => {
    nextEnvelope = envText(
      "caresp_f1",
      "I'll remember that.\n[MEMORY_FACT:preference:8]\nJoseph prefers tab indentation.\n[/MEMORY_FACT]\nDone.",
    );

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "I prefer tabs", toolsMode: "off" },
      }),
    );
    const { done } = await readSSE(r);
    assert.equal(done.factsExtracted, 1);

    const facts = await prisma.fact.findMany({ where: { userId: SERVER_USER_ID } });
    assert.equal(facts.length, 1);
    assert.match(facts[0].fullText, /tab indentation/);

    const msgs = await prisma.message.findMany({ where: { conversationId: myConvId, sender: "assistant" } });
    assert.doesNotMatch(msgs[0].text ?? "", /MEMORY_FACT/);
  });
});

describe("chat route — SSE controller lifecycle", () => {
  it("single-turn path closes the SSE stream cleanly without ERR_INVALID_STATE", async () => {
    // Regression for the double-close bug that caused the browser to see
    // `TypeError: network error` for every toolsMode=off / visual request.
    // The single-turn branch previously called `controller.close()` before
    // returning, but the outer `finally` block also called `.close()`,
    // raising `Invalid state: Controller is already closed`. That was
    // logged server-side as `failed to pipe response` and caused the
    // browser fetch to abort mid-stream.
    nextEnvelope = envText("caresp_close_ok", "Pong.", { input_tokens: 5, output_tokens: 2 });

    // Detect any unhandled rejection emitted during the run.
    const unhandled: unknown[] = [];
    const onRej = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onRej);

    let res: Response;
    try {
      res = await chatRoute.POST(
        makeReq("http://t/api/chat", {
          body: { conversationId: myConvId, message: "ping", toolsMode: "off" },
        }),
      );
      assert.equal(res.status, 200);
      const { done, sawError, events } = await readSSE(res);
      // No `error` event of the internal_error kind that the route would
      // send if the catch block fired on a thrown close.
      assert.equal(sawError, null);
      // `done` event must have fired — proves the stream wasn't aborted.
      assert.ok(events.some((e) => e.event === "done"));
      assert.ok(done && typeof done === "object");

      // Assistant message must have been persisted.
      const msgs = await prisma.message.findMany({
        where: { conversationId: myConvId, sender: "assistant" },
      });
      assert.equal(msgs.length, 1);
      assert.equal(msgs[0].text, "Pong.");

      // Give Node one tick to surface any pending unhandled rejection.
      await new Promise<void>((r) => setImmediate(r));
      assert.equal(
        unhandled.length,
        0,
        `unexpected unhandled rejection(s): ${unhandled.map(String).join("; ")}`,
      );
    } finally {
      process.off("unhandledRejection", onRej);
    }
  });
});

describe("chat route — envelope failure", () => {
  it("sends an error event when Foundry returns status=failed", async () => {
    nextEnvelope = {
      id: "caresp_fail",
      object: "response",
      status: "failed",
      error: { code: "rate_limited", message: "Too fast" },
      output: [],
    };

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "x", toolsMode: "off" },
      }),
    );
    const { sawError } = await readSSE(r);
    assert.notEqual(sawError, null);
    assert.equal(sawError?.code, "agent_failed");
  });
});
