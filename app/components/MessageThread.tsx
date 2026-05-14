"use client";

import { useEffect, useRef, useState } from "react";
import type { MessageRow, Persona } from "../lib/types";
import type { StreamState } from "../lib/hooks";
import { scroller } from "./styles";

export function sniffImageMime(b64: string): string {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("UklGR")) return "image/webp";
  if (b64.startsWith("R0lGO")) return "image/gif";
  return "image/png";
}

export function MessageThread({
  messages,
  pending,
  streamState,
  onApprove,
  onReject,
  onUndo,
}: {
  messages: MessageRow[];
  pending?: { text: string; persona: Persona | null } | null;
  streamState?: StreamState | null;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
  onUndo?: (snapshotDir: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length, pending?.text, streamState?.toolCalls.length, streamState?.toolResults.length, streamState?.approvalsRequired.length]);

  return (
    <div ref={ref} style={scroller}>
      {messages.length === 0 && !pending && !streamState && (
        <div style={{ color: "var(--text-dim)", padding: 30 }}>
          Start a conversation below. Cmd/Ctrl+Enter to send.
        </div>
      )}
      {messages.map((m) => (
        <Bubble key={m.id} m={m} />
      ))}
      {streamState && (streamState.toolCalls.length > 0 || streamState.approvalsRequired.length > 0) && (
        <ToolCallLog streamState={streamState} onApprove={onApprove} onReject={onReject} onUndo={onUndo} />
      )}
      {pending && (
        <Bubble
          m={{
            id: "pending",
            conversationId: "",
            sender: "assistant",
            persona: pending.persona,
            text: pending.text,
            imageBase64: null,
            toolCallsJson: null,
            taskKind: null,
            modelUsed: null,
            createdAt: new Date().toISOString(),
          }}
          isPending
        />
      )}
    </div>
  );
}

function ToolCallLog({
  streamState,
  onApprove,
  onReject,
  onUndo,
}: {
  streamState: StreamState;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
  onUndo?: (snapshotDir: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-start",
        marginBottom: 10,
      }}
    >
      <div
        style={{
          background: "var(--assistant)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "10px 12px",
          maxWidth: "70ch",
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--accent)" }}>
          Agent actions
        </div>
        {streamState.toolCalls.map((tc) => {
          const result = streamState.toolResults.find((r) => r.call_id === tc.call_id);
          const approval = streamState.approvalsRequired.find((a) => a.call_id === tc.call_id);
          return (
            <div key={tc.call_id} style={{ marginBottom: 8, paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "var(--text)" }}>{tc.name}</span>
                {!result && !approval && (
                  <span style={{ fontSize: 10, color: "var(--warn)" }}>running…</span>
                )}
                {result && result.status === "ok" && (
                  <span style={{ fontSize: 10, color: "var(--ok)" }}>✓ done</span>
                )}
                {result && result.rollbackDir && (
                  <button
                    onClick={() => onUndo?.(result.rollbackDir!)}
                    style={{ fontSize: 10, padding: "2px 6px", marginLeft: 4 }}
                    title="Restore files to state before this edit"
                  >
                    Undo
                  </button>
                )}
                {result && result.status === "error" && (
                  <span style={{ fontSize: 10, color: "var(--danger)" }}>✗ error</span>
                )}
                {approval && (
                  <span style={{ fontSize: 10, color: "var(--warn)" }}>⏸ approval required</span>
                )}
              </div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>
                {tc.arguments.slice(0, 120)}{tc.arguments.length > 120 ? "…" : ""}
              </div>
              {result?.diff && (
                <DiffPreview diff={result.diff} />
              )}
              {approval && (
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button
                    onClick={() => onApprove?.(approval.approvalId)}
                    style={{ fontSize: 11, padding: "4px 8px", background: "var(--ok)", color: "#000" }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => onReject?.(approval.approvalId)}
                    style={{ fontSize: 11, padding: "4px 8px" }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Unified-diff renderer for the ToolCallLog. This is the "moment of trust"
 * — Joseph approves writes from here, so the diff has to be unambiguously
 * legible. Renders proper red/green inline rows + a clear hunk header.
 *
 * Lines:
 *   `+++ a/file`, `--- b/file`, `Index:` — header (dim)
 *   `@@ -1,3 +1,5 @@`                    — hunk header (blue)
 *   `+ foo`                               — addition (green bg)
 *   `- foo`                               — deletion (red bg)
 *   ` foo`                                — context (default)
 */
function classifyDiffLine(line: string): "header" | "hunk" | "add" | "del" | "ctx" {
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("Index:") ||
    line.startsWith("diff ") ||
    line.startsWith("===")
  ) {
    return "header";
  }
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

const DIFF_STYLES: Record<ReturnType<typeof classifyDiffLine>, React.CSSProperties> = {
  header: { color: "var(--text-dim, #888)" },
  hunk: { color: "#5b9eff", background: "rgba(91,158,255,0.08)" },
  add: { color: "#7ee787", background: "rgba(126,231,135,0.08)" },
  del: { color: "#ff7b72", background: "rgba(255,123,114,0.08)" },
  ctx: { color: "var(--text, #ddd)" },
};

function countDiffStats(diff: string): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++") || l.startsWith("---")) continue;
    if (l.startsWith("+")) adds++;
    else if (l.startsWith("-")) dels++;
  }
  return { adds, dels };
}

function DiffPreview({ diff }: { diff: string }) {
  const [expanded, setExpanded] = useState(false);
  const allLines = diff.split("\n");
  const PREVIEW_LINES = 12;
  const lines = expanded ? allLines : allLines.slice(0, PREVIEW_LINES);
  const { adds, dels } = countDiffStats(diff);
  return (
    <div
      style={{
        marginTop: 6,
        background: "#0e1115",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 8,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        overflowX: "auto",
      }}
      data-testid="diff-preview"
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--text-dim)",
          marginBottom: 4,
          display: "flex",
          gap: 12,
        }}
      >
        <span>Diff preview</span>
        <span style={{ color: "#7ee787" }}>+{adds}</span>
        <span style={{ color: "#ff7b72" }}>−{dels}</span>
      </div>
      {lines.map((line, i) => {
        const kind = classifyDiffLine(line);
        return (
          <div
            key={i}
            style={{
              ...DIFF_STYLES[kind],
              whiteSpace: "pre",
              paddingLeft: 4,
              paddingRight: 4,
            }}
          >
            {line || "\u00A0"}
          </div>
        );
      })}
      {allLines.length > PREVIEW_LINES && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ fontSize: 10, marginTop: 4, padding: "2px 6px" }}
        >
          {expanded ? "Collapse" : `Show ${allLines.length - PREVIEW_LINES} more lines`}
        </button>
      )}
    </div>
  );
}

export function parseImageArray(b64Json: string): string[] {
  try {
    const parsed = JSON.parse(b64Json);
    if (Array.isArray(parsed) && parsed.every((i) => typeof i === "string"))
      return parsed;
  } catch {
    // Not a JSON array — single image stored as raw base64 string.
  }
  return [b64Json];
}

function ImageGallery({ b64Json, onOpen }: { b64Json: string; onOpen?: (index: number) => void }) {
  const images = parseImageArray(b64Json);
  return (
    <div
      style={{
        marginTop: 8,
        display: "grid",
        gridTemplateColumns: `repeat(min(${images.length}, 2), minmax(0, 1fr))`,
        gap: 8,
      }}
    >
      {images.map((img, i) => (
        <div key={i} style={{ cursor: onOpen ? "pointer" : "default" }} onClick={() => onOpen?.(i)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:${sniffImageMime(img)};base64,${img}`}
            alt={`generated-${i + 1}`}
            style={{
              maxWidth: "100%",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function Lightbox({ b64Json, startIndex, onClose }: { b64Json: string; startIndex: number; onClose: () => void }) {
  const images = parseImageArray(b64Json);
  const [index, setIndex] = useState(startIndex);
  const img = images[index];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:${sniffImageMime(img)};base64,${img}`}
          alt={`lightbox-${index + 1}`}
          style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 8 }}
        />
        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 8 }}>
          {images.length > 1 && (
            <>
              <button onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}>←</button>
              <span style={{ color: "#fff" }}>{index + 1} / {images.length}</span>
              <button onClick={() => setIndex((i) => (i + 1) % images.length)}>→</button>
            </>
          )}
          <button onClick={onClose}>×</button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ m, isPending }: { m: MessageRow; isPending?: boolean }) {
  const isUser = m.sender === "user";
  const isSystem = m.sender === "system";
  const isTool = m.sender === "tool";
  const align = isUser ? "flex-end" : "flex-start";
  const bg = isUser ? "var(--user)" : isSystem ? "#3a1f1f" : isTool ? "#1a2a1a" : "var(--assistant)";
  const [lightbox, setLightbox] = useState<number | null>(null);

  let displayText = m.text ?? "";
  let diff: string | undefined;
  if (isTool && displayText.startsWith("[TOOL_RESULT:")) {
    displayText = displayText.replace(/\[TOOL_RESULT:[\w_]+\]\n?/, "").replace(/\n?\[\/TOOL_RESULT\]/, "");
    if (m.toolCallsJson) {
      try {
        const parsed = JSON.parse(m.toolCallsJson);
        diff = parsed.diff;
      } catch {
        // ignore
      }
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: align, marginBottom: 10 }}>
      <div
        style={{
          background: bg,
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "10px 12px",
          maxWidth: "70ch",
          whiteSpace: "pre-wrap",
          opacity: isPending ? 0.7 : 1,
          fontSize: isTool ? 11 : 14,
        }}
      >
        {!isUser && (
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>
            {isTool ? "tool" : (m.persona ?? "assistant")}
            {m.taskKind ? ` · ${m.taskKind}` : ""}
            {m.modelUsed ? ` · ${m.modelUsed}` : ""}
            {isPending && " · thinking…"}
          </div>
        )}
        {displayText}
        {diff && <DiffPreview diff={diff} />}
        {m.imageBase64 && <ImageGallery b64Json={m.imageBase64} onOpen={(i) => setLightbox(i)} />}
        {m.toolCallsJson && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", color: "var(--text-dim)" }}>tool calls</summary>
            <pre>{m.toolCallsJson}</pre>
          </details>
        )}
      </div>
      {lightbox !== null && m.imageBase64 && (
        <Lightbox
          b64Json={m.imageBase64}
          startIndex={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
