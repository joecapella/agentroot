"use client";

import { useEffect, useRef } from "react";
import type { MessageRow } from "../lib/types";
import { scroller } from "./styles";

/**
 * Sniff the image MIME type from the first few base64 characters.
 *
 * Bug-8 fix: gpt-image-2 can return PNG, JPEG, or WebP. We previously
 * hard-coded the data URL prefix as `image/png`, which works only because
 * browsers sniff magic bytes. The data URL was effectively lying.
 *
 * The first few base64 characters of common image formats:
 *  - PNG:  `iVBOR` (89 50 4E 47 …)
 *  - JPEG: `/9j/`  (FF D8 FF …)
 *  - WebP: `UklGR` (RIFF …)
 *  - GIF:  `R0lGO` (47 49 46 …)
 */
function sniffImageMime(b64: string): string {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("UklGR")) return "image/webp";
  if (b64.startsWith("R0lGO")) return "image/gif";
  return "image/png"; // safe default — browsers will still sniff
}

export function MessageThread({ messages }: { messages: MessageRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length]);

  return (
    <div ref={ref} style={scroller}>
      {messages.length === 0 && (
        <div style={{ color: "var(--text-dim)", padding: 30 }}>
          Start a conversation below. Cmd/Ctrl+Enter to send.
        </div>
      )}
      {messages.map((m) => (
        <Bubble key={m.id} m={m} />
      ))}
    </div>
  );
}

function parseImageArray(b64Json: string): string[] {
  try {
    const parsed = JSON.parse(b64Json);
    if (Array.isArray(parsed) && parsed.every((i) => typeof i === "string"))
      return parsed;
  } catch {
    // Not a JSON array — single image stored as raw base64 string.
  }
  return [b64Json];
}

function ImageGallery({ b64Json }: { b64Json: string }) {
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
        <div key={i}>
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

function Bubble({ m }: { m: MessageRow }) {
  const isUser = m.sender === "user";
  const isSystem = m.sender === "system";
  const align = isUser ? "flex-end" : "flex-start";
  const bg = isUser ? "var(--user)" : isSystem ? "#3a1f1f" : "var(--assistant)";
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
        }}
      >
        {!isUser && (
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>
            {m.persona ?? "assistant"}
            {m.taskKind ? ` · ${m.taskKind}` : ""}
            {m.modelUsed ? ` · ${m.modelUsed}` : ""}
          </div>
        )}
        {m.text}
        {m.imageBase64 && (
          <ImageGallery b64Json={m.imageBase64} />
        )}
        {m.toolCallsJson && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", color: "var(--text-dim)" }}>tool calls</summary>
            <pre>{m.toolCallsJson}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
