import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applySearchReplace,
  createRollbackSnapshot,
  generateDiff,
  listDirectoryTool,
  restoreRollback,
  writeFileTool,
} from "@/src/server/fsTools";

describe("fsTools helpers", () => {
  let root = "";

  before(() => {
    root = mkdtempSync(join(tmpdir(), "agentroot-fs-"));
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("lists directories with file types", () => {
    writeFileSync(join(root, "alpha.txt"), "hi", "utf-8");
    mkdirSync(join(root, "nested"));
    const listed = listDirectoryTool({ path: ".", repoRoot: root });
    const names = listed.entries.map((e) => `${e.name}:${e.type}`).sort();
    assert.ok(names.includes("alpha.txt:file"));
    assert.ok(names.includes("nested:directory"));
  });

  it("writes files and returns byte length", () => {
    const result = writeFileTool({
      path: "notes/hello.txt",
      content: "hello world",
      repoRoot: root,
    });
    assert.equal(result.path, "notes/hello.txt");
    assert.equal(result.bytes, Buffer.byteLength("hello world", "utf-8"));
    assert.equal(readFileSync(join(root, "notes/hello.txt"), "utf-8"), "hello world");
  });

  it("applies search/replace to first occurrence only", () => {
    const filePath = join(root, "replace.txt");
    writeFileSync(filePath, "abc abc", "utf-8");
    applySearchReplace({
      path: "replace.txt",
      search: "abc",
      replace: "XYZ",
      repoRoot: root,
    });
    assert.equal(readFileSync(filePath, "utf-8"), "XYZ abc");
  });

  it("throws when search block is missing", () => {
    writeFileSync(join(root, "missing.txt"), "hello", "utf-8");
    assert.throws(
      () =>
        applySearchReplace({
          path: "missing.txt",
          search: "nope",
          replace: "yep",
          repoRoot: root,
        }),
      /search_not_found/,
    );
  });

  it("generates unified diffs", () => {
    const diff = generateDiff({
      path: "diff.txt",
      oldContent: "old\nline\n",
      newContent: "new\nline\n",
    });
    assert.ok(diff.patch.includes("-old"));
    assert.ok(diff.patch.includes("+new"));
  });

  it("creates rollback snapshots and restores them", () => {
    const fileRel = "rollback.txt";
    const filePath = join(root, fileRel);
    writeFileSync(filePath, "before", "utf-8");
    const snapshotDir = join(root, ".snapshot");
    createRollbackSnapshot({
      paths: [fileRel],
      repoRoot: root,
      snapshotDir,
    });
    writeFileSync(filePath, "after", "utf-8");
    restoreRollback({ snapshotDir, repoRoot: root });
    assert.equal(readFileSync(filePath, "utf-8"), "before");
  });
});
