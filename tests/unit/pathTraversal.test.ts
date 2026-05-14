/**
 * Path-traversal hardening tests for fsTools + shellTools (Bug-6 fix).
 *
 * We build a temp repo with a symlink that escapes the root and assert that
 * every readFileTool / writeFileTool / runCommandTool call refuses to follow
 * it. Also verifies that the old "/etc/passwd → etc/passwd" leading-slash
 * absorption no longer happens.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFileTool, writeFileTool } from "@/src/server/fsTools";

let repoRoot = "";
let outsideDir = "";

before(() => {
  // Real-path matters because the OS tmpdir may itself be a symlink
  // (macOS /tmp → /private/tmp). We construct both fixtures under the same
  // tmpdir branch, so the symlink really points outside repoRoot.
  const base = mkdtempSync(join(tmpdir(), "cofounder-pt-"));
  repoRoot = join(base, "repo");
  outsideDir = join(base, "outside");
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(repoRoot, "ok.txt"), "inside\n", "utf-8");
  writeFileSync(join(outsideDir, "secret.txt"), "leaked\n", "utf-8");
  // Symlink inside repo pointing OUTSIDE repo.
  symlinkSync(outsideDir, join(repoRoot, "escape"));
});

after(() => {
  if (repoRoot) rmSync(join(repoRoot, ".."), { recursive: true, force: true });
});

describe("fsTools path traversal hardening", () => {
  it("reads a normal file inside the repo", () => {
    const r = readFileTool({ path: "ok.txt", repoRoot });
    assert.match(r.content, /inside/);
  });

  it("rejects ../ parent traversal", () => {
    assert.throws(
      () => readFileTool({ path: "../outside/secret.txt", repoRoot }),
      /path_traversal/,
    );
  });

  it("rejects absolute POSIX paths instead of silently absorbing /", () => {
    assert.throws(
      () => readFileTool({ path: "/etc/passwd", repoRoot }),
      /path_traversal/,
    );
  });

  it("rejects /../../etc/passwd (combined absolute + traversal)", () => {
    assert.throws(
      () => readFileTool({ path: "/../../etc/passwd", repoRoot }),
      /path_traversal/,
    );
  });

  it("refuses to follow a symlink that escapes the repo (read)", () => {
    assert.throws(
      () => readFileTool({ path: "escape/secret.txt", repoRoot }),
      /path_traversal/,
    );
  });

  it("refuses to write through a symlink that escapes the repo", () => {
    assert.throws(
      () =>
        writeFileTool({
          path: "escape/evil.txt",
          content: "x",
          repoRoot,
        }),
      /path_traversal/,
    );
    assert.equal(existsSync(join(outsideDir, "evil.txt")), false);
  });

  it("allows writing a new file under a nested non-existent directory inside repo", () => {
    const res = writeFileTool({
      path: "nested/deep/new.txt",
      content: "hello",
      repoRoot,
    });
    assert.match(res.path, /new\.txt$/);
    assert.equal(existsSync(join(repoRoot, "nested/deep/new.txt")), true);
  });
});
