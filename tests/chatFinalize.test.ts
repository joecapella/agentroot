/**
 * /api/chat/finalize tests.
 *
 * The finalize route is the persistence half of the Ollama-first
 * (Pattern A) BYOK flow: the browser runs the LLM locally, then POSTs
 * the assistant text + token usage here. The server never sees the
 * model call.
 *
 * What we check:
 *  - happy path: creates a Conversation if no id, persists user +
 *    assistant messages, records token usage row.
 *  - ownership: an unknown conversationId returns 404.
 *  - secret redaction: assistant text with a fake bearer is stripped
 *    before DB write.
 *  - fact extraction: [MEMORY_FACT:..] markers are extracted from the
 *    assistant text and persisted as Fact rows.
 *  - bad body: malformed input returns bad_request 400.
 */
import { strict as assert } from "node:assert";
import { describe, it, before, after, beforeEach } from "node:test";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";

process.env.DATABASE_URL = "file:./test.db";

let prisma: typeof import("@/src/prisma").prisma;
let SERVER_USER_ID = "";
let finalizeRoute: typeof import("@/app/api/chat/finalize/route");

function makeReq(url: string, body: unknown): NextRequest {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

before(async () => {
  const migrated = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env },
  });
  assert.equal(migrated.status, 0);

  prisma = (await import("@/src/prisma")).prisma;
  SERVER_USER_ID = (await import("@/src/server/auth")).SERVER_USER_ID;
  finalizeRoute = await import("@/app/api/chat/finalize/route");
});

beforeEach(async () => {
  await prisma.tokenUsage.deleteMany({});
  await prisma.fact.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
});

after(async () => {
  await prisma.$disconnect();
});

describe("/api/chat/finalize — Ollama path persistence", () => {
  it("creates a conversation when no conversationId, persists user+assistant, records token usage", async () => {
    const res = await finalizeRoute.POST(
      makeReq("http://t/api/chat/finalize", {
        userMessage: "hello local model",
        assistantText: "Hi back from your laptop.",
        modelUsed: "ollama:llama3.2:3b",
        provider: "ollama",
        promptTokens: 10,
        completionTokens: 7,
      }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      conversation: { id: string };
      assistant: { id: string; text: string | null };
      factsExtracted: number;
    };
    assert.ok(body.conversation.id);
    assert.equal(body.assistant.text, "Hi back from your laptop.");
    assert.equal(body.factsExtracted, 0);

    const msgs = await prisma.message.findMany({
      where: { conversationId: body.conversation.id },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].sender, "user");
    assert.equal(msgs[0].text, "hello local model");
    assert.equal(msgs[1].sender, "assistant");
    assert.equal(msgs[1].modelUsed, "ollama:llama3.2:3b");

    const usage = await prisma.tokenUsage.findMany({
      where: { conversationId: body.conversation.id },
    });
    assert.equal(usage.length, 1);
    assert.equal(usage[0].promptTokens, 10);
    assert.equal(usage[0].completionTokens, 7);
    assert.equal(usage[0].modelUsed, "ollama:llama3.2:3b");
  });

  it("404s when conversationId references a non-owned/unknown conversation", async () => {
    const res = await finalizeRoute.POST(
      makeReq("http://t/api/chat/finalize", {
        conversationId: "does-not-exist",
        userMessage: "x",
        assistantText: "y",
        modelUsed: "ollama:foo",
      }),
    );
    assert.equal(res.status, 404);
  });

  it("redacts secrets from assistant text before persistence", async () => {
    const fakeToken = "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz";
    const res = await finalizeRoute.POST(
      makeReq("http://t/api/chat/finalize", {
        userMessage: "show me your config",
        assistantText: `Sure: API_KEY=${fakeToken} should work.`,
        modelUsed: "ollama:llama3.2:3b",
      }),
    );
    const body = (await res.json()) as { conversation: { id: string } };
    const msgs = await prisma.message.findMany({
      where: { conversationId: body.conversation.id, sender: "assistant" },
    });
    assert.equal(msgs.length, 1);
    assert.doesNotMatch(msgs[0].text ?? "", new RegExp(fakeToken));
  });

  it("extracts [MEMORY_FACT:..] markers from assistant text", async () => {
    const res = await finalizeRoute.POST(
      makeReq("http://t/api/chat/finalize", {
        userMessage: "I'm a vim user",
        assistantText:
          "Noted.\n[MEMORY_FACT:preference:8]\nUser prefers vim over emacs.\n[/MEMORY_FACT]\nGood to know.",
        modelUsed: "ollama:llama3.2:3b",
      }),
    );
    const body = (await res.json()) as {
      conversation: { id: string };
      factsExtracted: number;
    };
    assert.equal(body.factsExtracted, 1);

    const facts = await prisma.fact.findMany({ where: { userId: SERVER_USER_ID } });
    assert.equal(facts.length, 1);
    assert.match(facts[0].fullText, /prefers vim/);

    // Marker is stripped from the persisted assistant text.
    const msgs = await prisma.message.findMany({
      where: { conversationId: body.conversation.id, sender: "assistant" },
    });
    assert.doesNotMatch(msgs[0].text ?? "", /MEMORY_FACT/);
  });

  it("rejects malformed body with bad_request 400", async () => {
    const res = await finalizeRoute.POST(
      makeReq("http://t/api/chat/finalize", {
        // userMessage missing
        assistantText: "x",
        modelUsed: "ollama:foo",
      }),
    );
    assert.equal(res.status, 400);
  });
});
