import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

function makeReq(url: string) {
  return new NextRequest(url, { method: "GET" });
}

async function callSearch(q = "", limit = 50): Promise<Response> {
  const route = await import("@/app/api/files/search/route");
  return route.GET(makeReq(`http://t/api/files/search?q=${encodeURIComponent(q)}&limit=${limit}`));
}

async function json(res: Response): Promise<{ matches?: string[]; error?: string }> {
  return (await res.json()) as { matches?: string[]; error?: string };
}

describe("/api/files/search hardening", () => {
  let root = "";
  let outside = "";
  const oldRepoRoot = process.env.REPO_ROOT;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), "cofounder-files-"));
    root = join(base, "repo");
    outside = join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(root, "src.ts"), "ok", "utf-8");
    writeFileSync(join(root, ".env"), "SECRET=x", "utf-8");
    writeFileSync(join(root, "id_rsa"), "key", "utf-8");
    writeFileSync(join(outside, "outside-secret.ts"), "leak", "utf-8");
    symlinkSync(outside, join(root, "escape"));
    process.env.REPO_ROOT = root;
  });

  afterEach(() => {
    if (root) rmSync(join(root, ".."), { recursive: true, force: true });
    root = "";
    outside = "";
    if (oldRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = oldRepoRoot;
  });

  after(() => {
    if (oldRepoRoot === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = oldRepoRoot;
  });

  it("fails closed when REPO_ROOT is unset", async () => {
    delete process.env.REPO_ROOT;
    const res = await callSearch("src");
    assert.equal(res.status, 500);
    const body = await json(res);
    assert.match(String(body.error), /internal_error|repo_root_not_configured/);
  });

  it("returns normal files but filters secret names and symlink escapes", async () => {
    const res = await callSearch("");
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.deepEqual(body.matches, ["src.ts"]);
  });

  it("keys cache by REPO_ROOT so roots do not leak into each other", async () => {
    const first = await json(await callSearch("src"));
    assert.deepEqual(first.matches, ["src.ts"]);

    const root2 = mkdtempSync(join(tmpdir(), "cofounder-files-root2-"));
    writeFileSync(join(root2, "other.ts"), "ok", "utf-8");
    process.env.REPO_ROOT = root2;

    const second = await json(await callSearch(""));
    assert.deepEqual(second.matches, ["other.ts"]);
    rmSync(root2, { recursive: true, force: true });
  });

});
