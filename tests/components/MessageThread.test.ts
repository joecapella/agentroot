/**
 * Component-level tests for MessageThread pure helpers.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import * as React from "react";

import {
  MessageThread,
  parseImageArray,
  sniffImageMime,
} from "@/app/components/MessageThread";
import type { MessageRow } from "@/app/lib/types";
import type { StreamState } from "@/app/lib/hooks";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function collectText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (node && typeof node === "object" && "children" in node) {
    return collectText((node as { children?: unknown }).children);
  }
  return "";
}

describe("sniffImageMime", () => {
  it("detects PNG from iVBOR prefix", () => {
    assert.equal(sniffImageMime("iVBORw0KGgo"), "image/png");
  });
  it("detects JPEG from /9j/ prefix", () => {
    assert.equal(sniffImageMime("/9j/4AAQSkZJRg"), "image/jpeg");
  });
  it("detects WebP from UklGR prefix", () => {
    assert.equal(sniffImageMime("UklGRiIAAABXRUJQVlA4"), "image/webp");
  });
  it("falls back to image/png for unknown prefix", () => {
    assert.equal(sniffImageMime("abc123"), "image/png");
  });
});

describe("parseImageArray", () => {
  it("parses JSON array of base64 strings", () => {
    const input = JSON.stringify(["img1", "img2", "img3"]);
    const out = parseImageArray(input);
    assert.deepEqual(out, ["img1", "img2", "img3"]);
  });
  it("returns single-item array for raw base64 string", () => {
    const out = parseImageArray("rawbase64data");
    assert.deepEqual(out, ["rawbase64data"]);
  });
  it("returns single-item array for invalid JSON", () => {
    const out = parseImageArray("{invalid json");
    assert.deepEqual(out, ["{invalid json"]);
  });
  it("returns single-item array for non-array JSON", () => {
    const out = parseImageArray('{"not":"array"}');
    assert.deepEqual(out, ['{"not":"array"}']);
  });
});

describe("MessageThread rendering", () => {
  it("renders the empty state prompt", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        createElement(MessageThread, {
          messages: [],
          pending: null,
          streamState: null,
        }),
      );
    });
    const tree = renderer.toJSON();
    assert.ok(collectText(tree).includes("Start a conversation below."));
  });

  it("renders tool call log with approvals and undo", () => {
    const approvals: string[] = [];
    const rejects: string[] = [];
    const undos: string[] = [];
    const streamState: StreamState = {
      status: "running",
      imageProgress: null,
      partialMessage: null,
      loopCount: 0,
      toolCalls: [
        { call_id: "call-run", name: "read_file", arguments: "{}" },
        { call_id: "call-approve", name: "write_file", arguments: "{\"path\":\"a\"}" },
        { call_id: "call-done", name: "search_replace", arguments: "{\"path\":\"b\"}" },
      ],
      toolResults: [
        { call_id: "call-done", name: "search_replace", output: "ok", status: "ok", rollbackDir: "/tmp/rollback" },
      ],
      approvalsRequired: [
        { call_id: "call-approve", name: "write_file", approvalId: "appr-1", description: "Needs approval" },
      ],
    };

    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        createElement(MessageThread, {
          messages: [],
          streamState,
          onApprove: (id) => approvals.push(id),
          onReject: (id) => rejects.push(id),
          onUndo: (dir) => undos.push(dir),
        }),
      );
    });

    const root = renderer.root;
    const undoButton = root.find((node) => node.type === "button" && node.props.title === "Restore files to state before this edit");
    act(() => undoButton.props.onClick());
    assert.deepEqual(undos, ["/tmp/rollback"]);

    const approveButton = root.find((node) => node.type === "button" && node.children?.includes("Approve"));
    act(() => approveButton.props.onClick());
    const rejectButton = root.find((node) => node.type === "button" && node.children?.includes("Reject"));
    act(() => rejectButton.props.onClick());
    assert.deepEqual(approvals, ["appr-1"]);
    assert.deepEqual(rejects, ["appr-1"]);
  });

  it("renders diff preview and toggles expansion", () => {
    const diff = [
      "diff --git a/a.txt b/a.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "+added",
      " context",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
      "line 10",
      "line 11",
      "line 12",
      "line 13",
      "line 14",
    ].join("\n");
    const msg: MessageRow = {
      id: "m1",
      conversationId: "c1",
      sender: "tool",
      persona: null,
      text: "[TOOL_RESULT:write_file]\nDone\n[/TOOL_RESULT]",
      imageBase64: null,
      toolCallsJson: JSON.stringify({ diff }),
      taskKind: null,
      modelUsed: null,
      createdAt: new Date().toISOString(),
    };
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(createElement(MessageThread, { messages: [msg] }));
    });
    const root = renderer.root;
    const preview = root.findByProps({ "data-testid": "diff-preview" });
    assert.ok(preview);
    const toggle = root.find((node) => node.type === "button" && node.children?.some((c: unknown) => String(c).startsWith("Show ")));
    act(() => toggle.props.onClick());
    const expandedToggle = root.find((node) => node.type === "button" && node.children?.includes("Collapse"));
    assert.ok(expandedToggle);
  });

  it("opens the lightbox when clicking an image thumbnail", () => {
    const msg: MessageRow = {
      id: "m2",
      conversationId: "c1",
      sender: "assistant",
      persona: null,
      text: "Here are images",
      imageBase64: JSON.stringify(["iVBORw0KGgo", "/9j/4AAQSkZJRg"]),
      toolCallsJson: null,
      taskKind: null,
      modelUsed: null,
      createdAt: new Date().toISOString(),
    };
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(createElement(MessageThread, { messages: [msg] }));
    });
    const root = renderer.root;
    const clickableThumbs = root.findAll(
      (node) => node.type === "div" && node.props.style?.cursor === "pointer" && typeof node.props.onClick === "function",
    );
    act(() => clickableThumbs[0].props.onClick());
    const lightboxClose = root.find((node) => node.type === "button" && node.children?.includes("×"));
    assert.ok(lightboxClose);
  });
});
