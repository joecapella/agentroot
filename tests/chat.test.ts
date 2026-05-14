/**
 * Tests for /api/chat behaviour around envelope failures, oversized images,
 * response-id validation, and atomic persistence (Bug-2, Bug-5).
 *
 * The chat route invokes Foundry via `invokeAgent` from `src/foundryClient.ts`.
 * We patch the module's `require.cache` entry with a deterministic test
 * double so we never touch the network.
 */
import { strict as assert } from "node:assert";
import { describe, it, before, after, beforeEach } from "node:test";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";
import path from "node:path";
import { createRequire } from "node:module";

process.env.AZURE_AI_PROJECT_ENDPOINT =
  "https://example.invalid/api/projects/test";
process.env.COFOUNDER_AGENT_NAME = "TestAgent";
process.env.DATABASE_URL = "file:./test.db";

// ---------------------------------------------------------------------------
// Module stub for src/foundryClient — installed BEFORE we import the route.
// ---------------------------------------------------------------------------

type Envelope = {
  id: string;
  object: "response";
  status: "completed" | "failed";
  error: { code: string; message: string } | null;
  output: Array<{ type: string; [k: string]: unknown }>;
};

let nextEnvelope: Envelope | null = null;
let throwInvokeError: { status?: number; message: string } | null = null;
const invocations: Array<{ agentName: string; payload: Record<string, unknown> }> = [];

let prisma: typeof import("@/src/prisma").prisma;
let SERVER_USER_ID = "";
let chatRoute: typeof import("@/app/api/chat/route");
let projectsRoute: typeof import("@/app/api/conversations/projects/route");

function makeReq(
  url: string,
  init: { method?: string; body?: unknown } = {}
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

before(async () => {
  const migrated = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env },
  });
  assert.equal(migrated.status, 0);

  // Resolve and pre-load the real foundryClient so we can borrow its pure
  // helpers (isValidResponseId, flattenEnvelope, resolveEndpoint) inside the
  // stub. Then OVERWRITE the require cache entry with our double BEFORE the
  // chat route imports it.
  const real = await import("@/src/foundryClient");
  const localRequire = createRequire(import.meta.url);
  const foundryClientPath = localRequire.resolve(
    path.resolve(process.cwd(), "src/foundryClient.ts")
  );
  const stub = {
    ...real,
    invokeAgent: async (
      agentName: string,
      payload: Record<string, unknown>
    ): Promise<Envelope> => {
      invocations.push({ agentName, payload });
      if (throwInvokeError) {
        const err: Error & { status?: number } = new Error(throwInvokeError.message);
        err.status = throwInvokeError.status;
        throw err;
      }
      if (!nextEnvelope) throw new Error("test misconfigured: no envelope set");
      return nextEnvelope;
    },
    generateImages: async () => ({ images: [], droppedCount: 0 }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (localRequire.cache as any)[foundryClientPath] = {
    id: foundryClientPath,
    filename: foundryClientPath,
    loaded: true,
    exports: stub,
  };

  const prismaModule = await import("@/src/prisma");
  const authModule: typeof import("@/src/server/auth") = await import(
    "@/src/server/auth"
  );
  prisma = prismaModule.prisma;
  SERVER_USER_ID = authModule.SERVER_USER_ID;

  chatRoute = await import("@/app/api/chat/route");
  projectsRoute = await import("@/app/api/conversations/projects/route");

  await prisma.task.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
});

beforeEach(async () => {
  nextEnvelope = null;
  throwInvokeError = null;
  invocations.length = 0;
  await prisma.task.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  const c = await prisma.conversation.create({
    data: { userId: SERVER_USER_ID, title: "t" },
  });
  myConvId = c.id;
});

after(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chat route — atomic persistence (Bug-2, Bug-5)", () => {
  it("envelope failed: persists user+system msg, does NOT advance foundrySession", async () => {
    await prisma.conversation.update({
      where: { id: myConvId },
      data: { foundrySession: "caresp_PRIOR" },
    });

    nextEnvelope = {
      id: "caresp_FAILED",
      object: "response",
      status: "failed",
      error: { code: "upstream", message: "boom" },
      output: [],
    };

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "hi" },
      })
    );
    assert.equal(r.status, 502);

    const after = await prisma.conversation.findUnique({ where: { id: myConvId } });
    assert.equal(
      after?.foundrySession,
      "caresp_PRIOR",
      "session pointer must NOT advance on failed envelope"
    );

    const msgs = await prisma.message.findMany({
      where: { conversationId: myConvId },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].sender, "user");
    assert.equal(msgs[1].sender, "system");
  });

  it("transport-level failure: persists NOTHING", async () => {
    throwInvokeError = { status: 500, message: "network down" };

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "hi" },
      })
    );
    assert.equal(r.status, 502);

    const msgs = await prisma.message.findMany({
      where: { conversationId: myConvId },
    });
    assert.equal(msgs.length, 0);
  });

  it("oversized image: keeps text, drops image, marks droppedImage", async () => {
    const big = "A".repeat(14_700_000); // ~11 MB after base64 size math
    nextEnvelope = {
      id: "caresp_OK",
      object: "response",
      status: "completed",
      error: null,
      output: [
        {
          type: "message",
          id: "m1",
          content: [{ type: "output_text", text: "Here is your image" }],
        },
        {
          type: "image_generation_call",
          id: "img1",
          status: "completed",
          result: big,
        },
      ],
    };

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "draw an image" },
      })
    );
    assert.equal(r.status, 200, "should NOT 413 anymore — text is preserved");
    const body = (await r.json()) as {
      droppedImage?: boolean;
      assistant: { text: string | null; imageBase64: string | null };
    };
    assert.equal(body.droppedImage, true);
    assert.equal(body.assistant.text, "Here is your image");
    assert.equal(body.assistant.imageBase64, null);

    const msgs = await prisma.message.findMany({
      where: { conversationId: myConvId },
      orderBy: { createdAt: "asc" },
    });
    assert.ok(
      msgs.some((m) => m.sender === "system" && m.text?.includes("dropped")),
      "must record a system note that the image was dropped"
    );
  });

  it("non-Responses id: keeps prior session (Bug-5)", async () => {
    await prisma.conversation.update({
      where: { id: myConvId },
      data: { foundrySession: "caresp_PRIOR_VALID" },
    });

    nextEnvelope = {
      id: "deadbeefnotaresponseid",
      object: "response",
      status: "completed",
      error: null,
      output: [
        {
          type: "message",
          id: "m1",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
    };

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "hi" },
      })
    );
    assert.equal(r.status, 200);

    const after = await prisma.conversation.findUnique({ where: { id: myConvId } });
    assert.equal(after?.foundrySession, "caresp_PRIOR_VALID");
  });

  it("valid Responses id: advances foundrySession", async () => {
    nextEnvelope = {
      id: "caresp_NEW",
      object: "response",
      status: "completed",
      error: null,
      output: [
        {
          type: "message",
          id: "m1",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
    };

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: { conversationId: myConvId, message: "hi" },
      })
    );
    assert.equal(r.status, 200);

    const after = await prisma.conversation.findUnique({ where: { id: myConvId } });
    assert.equal(after?.foundrySession, "caresp_NEW");
  });

  it("toolsMode off suppresses hosted tools even for visual requests", async () => {
    nextEnvelope = {
      id: "caresp_TOOLS_OFF",
      object: "response",
      status: "completed",
      error: null,
      output: [
        {
          type: "message",
          id: "m1",
          content: [{ type: "output_text", text: "I cannot use tools right now." }],
        },
      ],
    };

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: {
          conversationId: myConvId,
          message: "generate a hero image for my app",
          toolsMode: "off",
        },
      })
    );
    assert.equal(r.status, 200);
    assert.equal(invocations.length, 1);
    assert.equal("tools" in invocations[0].payload, false);
  });

  it("toolsMode allowed attaches hosted image tool for visual requests", async () => {
    nextEnvelope = {
      id: "caresp_TOOLS_ALLOWED",
      object: "response",
      status: "completed",
      error: null,
      output: [
        {
          type: "message",
          id: "m1",
          content: [{ type: "output_text", text: "Generating." }],
        },
      ],
    };

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: {
          conversationId: myConvId,
          message: "generate a hero image for my app",
          toolsMode: "allowed",
        },
      })
    );
    assert.equal(r.status, 200);
    assert.equal(invocations.length, 1);
    assert.ok(Array.isArray(invocations[0].payload.tools));
  });

  it("visual task calls generateImages directly and returns text when images fail", async () => {
    nextEnvelope = {
      id: "caresp_VISUAL",
      object: "response",
      status: "completed",
      error: null,
      output: [
        {
          type: "message",
          id: "m1",
          content: [{ type: "output_text", text: "Here are 3 mockups." }],
        },
      ],
    };

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: {
          conversationId: myConvId,
          message: "generate 3 website mockups",
          toolsMode: "allowed",
        },
      })
    );
    assert.equal(r.status, 200);
    const body = (await r.json()) as {
      assistant: { text: string | null; imageBase64: string | null };
    };
    assert.equal(body.assistant.text, "Here are 3 mockups.");
    assert.equal(body.assistant.imageBase64, null);
  });

  it("forwards task kind to the hosted agent input", async () => {
    nextEnvelope = {
      id: "caresp_TASK_KIND",
      object: "response",
      status: "completed",
      error: null,
      output: [
        {
          type: "message",
          id: "m1",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
    };

    const r = await chatRoute.POST(
      makeReq("http://t/api/chat", {
        body: {
          conversationId: myConvId,
          message: "debug this next.js prisma bug",
          reasoningProfile: "deep",
        },
      })
    );
    assert.equal(r.status, 200);
    assert.equal(invocations.length, 1);
    assert.match(String(invocations[0].payload.input), /^\[persona:code_assistant\] \[task:code_repo\] /);
  });
});

describe("/api/conversations/projects (Bug-4)", () => {
  it("returns distinct projects across all conversations, owner-scoped", async () => {
    await prisma.message.deleteMany({});
    await prisma.conversation.deleteMany({});
    await prisma.conversation.create({
      data: { userId: SERVER_USER_ID, title: "a", project: "p1" },
    });
    await prisma.conversation.create({
      data: { userId: SERVER_USER_ID, title: "b", project: "p1" },
    });
    await prisma.conversation.create({
      data: { userId: SERVER_USER_ID, title: "c", project: "p2" },
    });
    await prisma.conversation.create({
      data: { userId: SERVER_USER_ID, title: "d", project: null },
    });
    await prisma.conversation.create({
      data: { userId: "stranger", title: "e", project: "p-stranger" },
    });

    const r = await projectsRoute.GET(
      makeReq("http://t/api/conversations/projects", { method: "GET" })
    );
    assert.equal(r.status, 200);
    const body = (await r.json()) as { projects: string[] };
    assert.deepEqual(body.projects, ["p1", "p2"]);
    assert.ok(!body.projects.includes("p-stranger"));
  });
});
