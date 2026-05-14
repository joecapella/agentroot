/**
 * Local-only API regression tests. Run with `npm test`.
 *
 * Joseph is the only intended user of this local app, so auth/session/CSRF
 * gates are intentionally disabled. These tests lock in that local-mode
 * behavior while preserving the important safety boundaries that still matter:
 * ownership checks, no implicit `open_url`, unsafe URL rejection, and sanitized
 * errors.
 */
import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";

process.env.AZURE_AI_PROJECT_ENDPOINT =
  "https://example.invalid/api/projects/test";
process.env.COFOUNDER_AGENT_NAME = "TestAgent";
process.env.DATABASE_URL = "file:./test.db";

type Prisma = typeof import("@/src/prisma").prisma;
type ServerAuth = typeof import("@/src/server/auth");

let prisma: Prisma;
let SERVER_USER_ID = "";
let chatRoute: typeof import("@/app/api/chat/route");
let convListRoute: typeof import("@/app/api/conversations/route");
let convIdRoute: typeof import("@/app/api/conversations/[id]/route");
let convTitleRoute: typeof import("@/app/api/conversations/[id]/title/route");
let tasksRoute: typeof import("@/app/api/tasks/route");
let settingsRoute: typeof import("@/app/api/settings/route");
let openUrlRoute: typeof import("@/app/api/tools/open_url/route");
let openUrlApproveRoute: typeof import("@/app/api/tools/open_url/approve/[taskId]/route");
let createTodoRoute: typeof import("@/app/api/tools/create_todo/route");
let authUnlockRoute: typeof import("@/app/api/auth/unlock/route");
let authSessionRoute: typeof import("@/app/api/auth/session/route");
let authLogoutRoute: typeof import("@/app/api/auth/logout/route");

function req(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {}
): NextRequest {
  const headers = new Headers(init.headers ?? {});
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

let myConvId = "";
let theirConvId = "";
let theirAwaitingTaskId = "";

before(async () => {
  const migrated = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env },
  });
  assert.equal(migrated.status, 0);

  const prismaModule = await import("@/src/prisma");
  const authModule: ServerAuth = await import("@/src/server/auth");
  prisma = prismaModule.prisma;
  SERVER_USER_ID = authModule.SERVER_USER_ID;

  chatRoute = await import("@/app/api/chat/route");
  convListRoute = await import("@/app/api/conversations/route");
  convIdRoute = await import("@/app/api/conversations/[id]/route");
  convTitleRoute = await import("@/app/api/conversations/[id]/title/route");
  tasksRoute = await import("@/app/api/tasks/route");
  settingsRoute = await import("@/app/api/settings/route");
  openUrlRoute = await import("@/app/api/tools/open_url/route");
  openUrlApproveRoute = await import(
    "@/app/api/tools/open_url/approve/[taskId]/route"
  );
  createTodoRoute = await import("@/app/api/tools/create_todo/route");
  authUnlockRoute = await import("@/app/api/auth/unlock/route");
  authSessionRoute = await import("@/app/api/auth/session/route");
  authLogoutRoute = await import("@/app/api/auth/logout/route");

  await prisma.task.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});

  const mine = await prisma.conversation.create({
    data: { userId: SERVER_USER_ID, title: "mine" },
  });
  const theirs = await prisma.conversation.create({
    data: { userId: "stranger", title: "theirs" },
  });
  myConvId = mine.id;
  theirConvId = theirs.id;

  await prisma.task.create({
    data: {
      conversationId: mine.id,
      type: "open_url",
      status: "AWAITING_APPROVAL",
      paramsJson: JSON.stringify({ url: "https://example.com" }),
    },
  });
  const theirTask = await prisma.task.create({
    data: {
      conversationId: theirs.id,
      type: "open_url",
      status: "AWAITING_APPROVAL",
      paramsJson: JSON.stringify({ url: "https://example.com" }),
    },
  });
  theirAwaitingTaskId = theirTask.id;
});

after(async () => {
  await prisma.$disconnect();
});

describe("local-only mode", () => {
  it("auth/session/logout compatibility endpoints are open no-ops", async () => {
    const unlock = await authUnlockRoute.POST();
    const session = await authSessionRoute.GET();
    const logout = await authLogoutRoute.POST();
    assert.equal(unlock.status, 200);
    assert.equal(session.status, 200);
    assert.equal(logout.status, 200);
    assert.equal((await session.json()).authenticated, true);
  });

  it("conversations.GET works without cookie or X-Requested-With", async () => {
    const r = await convListRoute.GET(req("http://t/api/conversations"));
    assert.equal(r.status, 200);
    const body = (await r.json()) as { conversations: Array<{ id: string }> };
    assert.ok(body.conversations.some((c) => c.id === myConvId));
    assert.ok(!body.conversations.some((c) => c.id === theirConvId));
  });

  it("conversations.POST works without cookie or X-Requested-With", async () => {
    const r = await convListRoute.POST(
      req("http://t/api/conversations", {
        method: "POST",
        body: { title: "local create" },
      })
    );
    assert.equal(r.status, 200);
    const body = (await r.json()) as { conversation: { userId: string } };
    assert.equal(body.conversation.userId, SERVER_USER_ID);
  });

  it("conversation title PATCH accepts an empty body for auto-regeneration", async () => {
    const r = await convTitleRoute.PATCH(
      req(`http://t/api/conversations/${myConvId}/title`, { method: "PATCH" }),
      { params: Promise.resolve({ id: myConvId }) }
    );
    assert.equal(r.status, 200);
    const body = (await r.json()) as { conversation: { id: string; title: string } };
    assert.equal(body.conversation.id, myConvId);
    assert.equal(body.conversation.title, "mine");
  });
});

describe("cross-user ownership", () => {
  it("conversation.GET on stranger's id → 404", async () => {
    const r = await convIdRoute.GET(
      req(`http://t/api/conversations/${theirConvId}`),
      { params: Promise.resolve({ id: theirConvId }) }
    );
    assert.equal(r.status, 404);
  });

  it("conversation.DELETE on stranger's id → 404 and doesn't delete", async () => {
    const before = await prisma.conversation.count({ where: { id: theirConvId } });
    assert.equal(before, 1);
    const r = await convIdRoute.DELETE(
      req(`http://t/api/conversations/${theirConvId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: theirConvId }) }
    );
    assert.equal(r.status, 404);
    const after = await prisma.conversation.count({ where: { id: theirConvId } });
    assert.equal(after, 1);
  });

  it("chat.POST with stranger's conversationId → 404, no message appended", async () => {
    const before = await prisma.message.count({
      where: { conversationId: theirConvId },
    });
    const r = await chatRoute.POST(
      req("http://t/api/chat", {
        method: "POST",
        body: { conversationId: theirConvId, message: "sneak" },
      })
    );
    assert.equal(r.status, 404);
    const after = await prisma.message.count({
      where: { conversationId: theirConvId },
    });
    assert.equal(after, before);
  });

  it("tasks.GET with stranger's conversationId → 404", async () => {
    const r = await tasksRoute.GET(req(`http://t/api/tasks?conversationId=${theirConvId}`));
    assert.equal(r.status, 404);
  });

  it("tasks.GET unscoped → only owner's tasks", async () => {
    const r = await tasksRoute.GET(req("http://t/api/tasks"));
    assert.equal(r.status, 200);
    const body = (await r.json()) as { tasks: Array<{ conversationId: string }> };
    for (const t of body.tasks) {
      assert.notEqual(t.conversationId, theirConvId);
    }
  });
});

describe("open_url two-step flow", () => {
  it("POST /api/tools/open_url creates AWAITING_APPROVAL, never COMPLETED", async () => {
    const r = await openUrlRoute.POST(
      req("http://t/api/tools/open_url", {
        method: "POST",
        body: { url: "https://example.com", conversationId: myConvId },
      })
    );
    assert.equal(r.status, 200);
    const body = (await r.json()) as { status: string };
    assert.equal(body.status, "AWAITING_APPROVAL");
  });

  it("approve cross-user task → 404 and task is NOT executed", async () => {
    const r = await openUrlApproveRoute.POST(
      req(`http://t/api/tools/open_url/approve/${theirAwaitingTaskId}`, {
        method: "POST",
      }),
      { params: Promise.resolve({ taskId: theirAwaitingTaskId }) }
    );
    assert.equal(r.status, 404);
    const after = await prisma.task.findUnique({ where: { id: theirAwaitingTaskId } });
    assert.equal(after?.status, "AWAITING_APPROVAL");
  });

  it("approve unknown task → 404", async () => {
    const r = await openUrlApproveRoute.POST(
      req("http://t/api/tools/open_url/approve/nope", { method: "POST" }),
      { params: Promise.resolve({ taskId: "nope" }) }
    );
    assert.equal(r.status, 404);
  });

  it("rejects javascript: URL on POST", async () => {
    const r = await openUrlRoute.POST(
      req("http://t/api/tools/open_url", {
        method: "POST",
        body: { url: "javascript:alert(1)", conversationId: myConvId },
      })
    );
    assert.notEqual(r.status, 200);
  });

  it("conversation-less open_url task is owner-scoped and reaches param validation on approve", async () => {
    const create = await openUrlRoute.POST(
      req("http://t/api/tools/open_url", {
        method: "POST",
        body: { url: "https://example.com", reason: "global task" },
      })
    );
    assert.equal(create.status, 200);
    const created = (await create.json()) as { taskId: string };

    const listed = await tasksRoute.GET(req("http://t/api/tasks"));
    assert.equal(listed.status, 200);
    const listedBody = (await listed.json()) as {
      tasks: Array<{ id: string; conversationId: string | null }>;
    };
    assert.ok(
      listedBody.tasks.some(
        (t) => t.id === created.taskId && t.conversationId === null
      ),
      "unscoped task list should include local user's conversation-less task"
    );

    await prisma.task.update({
      where: { id: created.taskId },
      data: { paramsJson: "not-json" },
    });
    const approve = await openUrlApproveRoute.POST(
      req(`http://t/api/tools/open_url/approve/${created.taskId}`, {
        method: "POST",
      }),
      { params: Promise.resolve({ taskId: created.taskId }) }
    );
    assert.equal(approve.status, 400);
    const after = await prisma.task.findUnique({ where: { id: created.taskId } });
    assert.equal(after?.status, "FAILED");
  });
});

describe("create_todo task flow", () => {
  it("conversation-less todo task is owner-scoped and visible in unscoped task list", async () => {
    const r = await createTodoRoute.POST(
      req("http://t/api/tools/create_todo", {
        method: "POST",
        body: { title: "global todo" },
      })
    );
    assert.equal(r.status, 200);
    const created = (await r.json()) as { taskId: string };

    const listed = await tasksRoute.GET(req("http://t/api/tasks"));
    assert.equal(listed.status, 200);
    const listedBody = (await listed.json()) as {
      tasks: Array<{ id: string; conversationId: string | null }>;
    };
    assert.ok(
      listedBody.tasks.some(
        (t) => t.id === created.taskId && t.conversationId === null
      ),
      "unscoped task list should include local user's conversation-less todo"
    );
  });
});

describe("error sanitization", () => {
  it("settings.GET does not return CONFIG_DIR", async () => {
    const r = await settingsRoute.GET(req("http://t/api/settings"));
    const body = await r.json();
    assert.ok(!("dir" in body), "response must not contain 'dir'");
    assert.ok("files" in body);
  });

  it("error responses are {error, requestId?} only", async () => {
    const r = await chatRoute.POST(
      req("http://t/api/chat", {
        method: "POST",
        body: { conversationId: theirConvId, message: "x" },
      })
    );
    const body = (await r.json()) as Record<string, unknown>;
    assert.equal(Object.keys(body).sort().join(","), "error");
  });
});

// ── Memory layer tests ─────────────────────────────────────────────────────

const THEIR_USER_ID = "stranger";

describe("memory layer", async () => {
  let profileRoute: typeof import("@/app/api/profile/route") | null = null;
  let factsRoute: typeof import("@/app/api/facts/route") | null = null;
  let factsIdRoute: typeof import("@/app/api/facts/[id]/route") | null = null;

  before(async () => {
    // Lazy-load new routes so the suite still runs on an unpatched checkout.
    try {
      profileRoute = await import("@/app/api/profile/route");
      factsRoute = await import("@/app/api/facts/route");
      factsIdRoute = await import("@/app/api/facts/[id]/route");
    } catch {
      /* routes may not exist yet on an unpatched checkout */
    }
    if (!profileRoute) return;
    // Clean up any stale test rows.
    await prisma.fact.deleteMany({ where: { userId: SERVER_USER_ID } });
    await prisma.fact.deleteMany({ where: { userId: THEIR_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: SERVER_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: THEIR_USER_ID } });
  });

  it("profile.GET creates initial profile on first call and scopes to userId", async () => {
    if (!profileRoute) return;
    const r = await profileRoute.GET(req("http://t/api/profile"));
    assert.equal(r.status, 200);
    const body = (await r.json()) as { profile: { userId: string; displayName: string } };
    assert.equal(body.profile.userId, SERVER_USER_ID);
    assert.equal(body.profile.displayName, "Joseph");
  });

  it("profile.GET isolates user A from user B", async () => {
    if (!profileRoute) return;
    // Create profile for the "owner" first.
    await profileRoute.GET(req("http://t/api/profile"));

    // Their profile.
    const theirs = await prisma.userProfile.create({
      data: { userId: THEIR_USER_ID, displayName: "Stranger" },
    });

    // Our get should NOT return theirs.
    const r = await profileRoute.GET(req("http://t/api/profile"));
    const body = (await r.json()) as { profile: { userId: string } };
    assert.equal(body.profile.userId, SERVER_USER_ID);
    assert.notEqual(body.profile.userId, THEIR_USER_ID);

    await prisma.userProfile.delete({ where: { id: theirs.id } });
  });

  it("profile.PATCH updates the owner's profile", async () => {
    if (!profileRoute) return;
    await profileRoute.GET(req("http://t/api/profile"));
    const r = await profileRoute.PATCH(
      req("http://t/api/profile", {
        method: "PATCH",
        body: { displayName: "Updated" },
      })
    );
    assert.equal(r.status, 200);
    const body = (await r.json()) as { profile: { displayName: string } };
    assert.equal(body.profile.displayName, "Updated");
  });

  it("facts.POST and facts.GET work round-trip", async () => {
    if (!factsRoute) return;
    const create = await factsRoute.POST(
      req("http://t/api/facts", {
        method: "POST",
        body: {
          category: "preference",
          label: "Test fact",
          fullText: "Joseph prefers tabs over spaces.",
          importance: 7,
        },
      })
    );
    assert.equal(create.status, 201);
    const body = (await create.json()) as { fact: { id: string } };

    const list = await factsRoute.GET(req("http://t/api/facts"));
    const listBody = (await list.json()) as { items: Array<{ id: string }>; total: number };
    assert.ok(listBody.items.some((f) => f.id === body.fact.id));
    assert.equal(listBody.total, 1);

    // Cleanup
    await prisma.fact.delete({ where: { id: body.fact.id } });
  });

  it("facts.GET does not expose another user's facts", async () => {
    if (!factsRoute) return;
    const theirFact = await prisma.fact.create({
      data: {
        userId: THEIR_USER_ID,
        category: "preference",
        label: "Their fact",
        fullText: "Stranger likes spaces",
        importance: 10,
      },
    });

    const list = await factsRoute.GET(req("http://t/api/facts"));
    const body = (await list.json()) as { items: Array<{ id: string }> };
    assert.ok(!body.items.some((f) => f.id === theirFact.id), "must not leak cross-user facts");

    await prisma.fact.delete({ where: { id: theirFact.id } });
  });

  it("facts.GET supports category filter", async () => {
    if (!factsRoute) return;
    const f1 = await prisma.fact.create({
      data: {
        userId: SERVER_USER_ID,
        category: "constraint",
        label: "C1",
        fullText: "x",
        importance: 5,
      },
    });
    const f2 = await prisma.fact.create({
      data: {
        userId: SERVER_USER_ID,
        category: "preference",
        label: "P1",
        fullText: "y",
        importance: 5,
      },
    });

    const filtered = await factsRoute.GET(
      req("http://t/api/facts?category=constraint")
    );
    const body = (await filtered.json()) as { items: Array<{ id: string }> };
    assert.ok(body.items.some((f) => f.id === f1.id));
    assert.ok(!body.items.some((f) => f.id === f2.id));

    await prisma.fact.deleteMany({ where: { id: { in: [f1.id, f2.id] } } });
  });

  it("facts/:id.PATCH updates and scopes to owner", async () => {
    if (!factsIdRoute) return;
    const fact = await prisma.fact.create({
      data: {
        userId: SERVER_USER_ID,
        category: "preference",
        label: "old label",
        fullText: "x",
        importance: 5,
      },
    });

    const r = await factsIdRoute.PATCH(
      req(`http://t/api/facts/${fact.id}`, {
        method: "PATCH",
        body: { label: "new label", importance: 8 },
      }),
      { params: Promise.resolve({ id: fact.id }) }
    );
    assert.equal(r.status, 200);
    const body = (await r.json()) as { fact: { label: string; importance: number } };
    assert.equal(body.fact.label, "new label");
    assert.equal(body.fact.importance, 8);

    await prisma.fact.delete({ where: { id: fact.id } });
  });

  it("facts/:id.DELETE removes the fact and returns 404 after", async () => {
    if (!factsIdRoute) return;
    const fact = await prisma.fact.create({
      data: {
        userId: SERVER_USER_ID,
        category: "preference",
        label: "to delete",
        fullText: "x",
        importance: 5,
      },
    });

    const r = await factsIdRoute.DELETE(
      req(`http://t/api/facts/${fact.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: fact.id }) }
    );
    assert.equal(r.status, 200);

    const after = await prisma.fact.findUnique({ where: { id: fact.id } });
    assert.equal(after, null, "fact should be deleted");
  });

  it("facts/:id.GET returns 404 for cross-user fact", async () => {
    if (!factsIdRoute) return;
    const theirFact = await prisma.fact.create({
      data: {
        userId: THEIR_USER_ID,
        category: "preference",
        label: "theirs",
        fullText: "x",
        importance: 5,
      },
    });

    const r = await factsIdRoute.GET(
      req(`http://t/api/facts/${theirFact.id}`),
      { params: Promise.resolve({ id: theirFact.id }) }
    );
    assert.equal(r.status, 404);

    await prisma.fact.delete({ where: { id: theirFact.id } });
  });
});
