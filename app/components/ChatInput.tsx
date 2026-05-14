"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ImageQuality,
  ImageSize,
  Persona,
  ReasoningProfile,
  ToolsMode,
} from "../lib/types";
import { api, ApiError } from "../lib/apiClient";
import { footer } from "./styles";
import { getDefaultOllamaModel } from "../lib/ollamaClient";

const PERSONAS: { value: Persona | "auto"; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "orchestrator", label: "Orchestrator" },
  { value: "code_assistant", label: "Code" },
  { value: "brand_designer", label: "Brand" },
  { value: "ops", label: "Ops" },
  { value: "vision", label: "Vision" },
];

const IMAGE_QUALITIES: ImageQuality[] = ["auto", "low", "medium", "high"];
const IMAGE_SIZES: { value: ImageSize; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "1024x1024", label: "1024×1024 (square)" },
  { value: "1024x1536", label: "1024×1536 (portrait)" },
  { value: "1536x1024", label: "1536×1024 (landscape)" },
];

/** Persona values where the image controls are relevant. `auto` is included
 *  because the router may still pick a visual task. */
const IMAGE_PERSONAS = new Set<Persona | "auto">([
  "auto",
  "brand_designer",
  "vision",
]);

interface Props {
  draft: string;
  setDraft: (v: string) => void;
  reasoning: ReasoningProfile;
  setReasoning: (v: ReasoningProfile) => void;
  tools: ToolsMode;
  setTools: (v: ToolsMode) => void;
  persona: Persona | "auto";
  setPersona: (v: Persona | "auto") => void;
  imageQuality: ImageQuality;
  setImageQuality: (v: ImageQuality) => void;
  imageSize: ImageSize;
  setImageSize: (v: ImageSize) => void;
  sending: boolean;
  onSend: () => void;
  onStop?: () => void;
  onImageUpload?: (base64: string, mime: string) => void;
  uploadedImage?: { base64: string; mime: string } | null;
  onClearImage?: () => void;
}

export function ChatInput({
  draft,
  setDraft,
  reasoning,
  setReasoning,
  tools,
  setTools,
  persona,
  setPersona,
  imageQuality,
  setImageQuality,
  imageSize,
  setImageSize,
  sending,
  onSend,
  onStop,
  onImageUpload,
  uploadedImage,
  onClearImage,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── @-mention file autocomplete ───────────────────────────────────────────
  // When the user types `@somepath` we show a small list of matching repo
  // files. Selecting one replaces the @token with the relative path so the
  // model sees an explicit anchor to read.
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionMatches, setMentionMatches] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionAbortRef = useRef<AbortController | null>(null);

  // Local Ollama indicator
  const [activeLocalModel, setActiveLocalModel] = useState<string | null>(null);
  useEffect(() => {
    setActiveLocalModel(getDefaultOllamaModel());
    const onStorage = () => setActiveLocalModel(getDefaultOllamaModel());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function detectMention(value: string, caret: number) {
    // Find the start of the @-token immediately before the caret.
    // Tokens are bounded by whitespace; we don't trigger on emails (no `.`).
    let i = caret - 1;
    while (i >= 0 && !/\s/.test(value[i])) i--;
    const tokenStart = i + 1;
    const token = value.slice(tokenStart, caret);
    if (!token.startsWith("@") || token.length > 80) {
      setMention(null);
      setMentionMatches([]);
      return;
    }
    // Bail on email-like tokens (`@foo.com`).
    if (/^@[^/]+@/.test(token) || /^@\S+\.[a-z]{2,4}$/i.test(token)) {
      setMention(null);
      return;
    }
    setMention({ query: token.slice(1), start: tokenStart });
  }

  useEffect(() => {
    if (!mention) return;
    if (mentionAbortRef.current) mentionAbortRef.current.abort();
    const ctl = new AbortController();
    mentionAbortRef.current = ctl;
    const handle = window.setTimeout(async () => {
      try {
        const data = await api<{ matches: string[] }>("/api/files/search", {
          query: { q: mention.query, limit: "8" },
          signal: ctl.signal,
        });
        if (!ctl.signal.aborted) {
          setMentionMatches(data.matches);
          setMentionIndex(0);
        }
      } catch (err) {
        if (err instanceof ApiError) console.warn("file search:", err.code);
      }
    }, 80);
    return () => {
      window.clearTimeout(handle);
      ctl.abort();
    };
  }, [mention?.query, mention?.start]);

  function insertMention(path: string) {
    if (!mention) return;
    const before = draft.slice(0, mention.start);
    // End of current @-token after the start (we re-replace just the
    // @-token, leaving any trailing whitespace the user already typed).
    const caretEnd = mention.start + 1 + mention.query.length;
    const after = draft.slice(caretEnd);
    setDraft(`${before}@${path}${after.startsWith(" ") ? "" : " "}${after}`);
    setMention(null);
    setMentionMatches([]);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        const newCaret = before.length + path.length + 2;
        el.focus();
        el.setSelectionRange(newCaret, newCaret);
      }
    });
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file && onImageUpload) {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            onImageUpload(result, file.type);
          };
          reader.readAsDataURL(file);
        }
        e.preventDefault();
        return;
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/") && onImageUpload) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        onImageUpload(result, file.type);
      };
      reader.readAsDataURL(file);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <footer style={footer}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        {uploadedImage && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img
              src={uploadedImage.base64}
              alt="uploaded"
              style={{ maxHeight: 60, borderRadius: 4, border: "1px solid var(--border)" }}
            />
            <button onClick={onClearImage} style={{ fontSize: 12 }}>Remove image</button>
          </div>
        )}
        <div style={{ position: "relative", flex: 1 }}>
          <textarea
            ref={ref}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              detectMention(e.target.value, e.target.selectionStart);
            }}
            onClick={(e) => {
              const el = e.target as HTMLTextAreaElement;
              detectMention(el.value, el.selectionStart);
            }}
            onKeyUp={(e) => {
              const el = e.target as HTMLTextAreaElement;
              if (
                e.key === "ArrowLeft" ||
                e.key === "ArrowRight" ||
                e.key === "Home" ||
                e.key === "End"
              ) {
                detectMention(el.value, el.selectionStart);
              }
            }}
            onKeyDown={(e) => {
              // @-mention navigation
              if (mention && mentionMatches.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIndex((i) => (i + 1) % mentionMatches.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIndex(
                    (i) => (i - 1 + mentionMatches.length) % mentionMatches.length,
                  );
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.metaKey && !e.ctrlKey)) {
                  e.preventDefault();
                  insertMention(mentionMatches[mentionIndex]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSend();
              }
            }}
            onPaste={handlePaste}
            placeholder="Ask, plan, decide… (@ to mention a file · Cmd/Ctrl+Enter to send · paste image)"
            disabled={sending}
            style={{ width: "100%", minHeight: 60 }}
          />
          {mention && mentionMatches.length > 0 && (
            <div
              role="listbox"
              data-testid="mention-suggestions"
              style={{
                position: "absolute",
                left: 8,
                bottom: "100%",
                marginBottom: 4,
                background: "var(--panel, #181818)",
                border: "1px solid var(--border, #2a2a2a)",
                borderRadius: 6,
                padding: 4,
                minWidth: 280,
                maxWidth: 480,
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                zIndex: 30,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
              }}
            >
              {mentionMatches.map((m, i) => (
                <div
                  key={m}
                  role="option"
                  aria-selected={i === mentionIndex}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(m);
                  }}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    cursor: "pointer",
                    background:
                      i === mentionIndex
                        ? "rgba(91,158,255,0.12)"
                        : "transparent",
                    color:
                      i === mentionIndex
                        ? "var(--accent, #5b9eff)"
                        : "var(--text, #ddd)",
                  }}
                >
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
        <select value={persona} onChange={(e) => setPersona(e.target.value as Persona | "auto")}>
          {PERSONAS.map((p) => (
            <option key={p.value} value={p.value}>Persona: {p.label}</option>
          ))}
        </select>
        {activeLocalModel && (
          <div
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 999,
              background: "rgba(34,197,94,0.15)",
              color: "var(--ok)",
              alignSelf: "flex-start",
            }}
            title="Chatting with local Ollama model"
          >
            🦙 {activeLocalModel}
          </div>
        )}
        <select value={reasoning} onChange={(e) => setReasoning(e.target.value as ReasoningProfile)}>
          <option value="fast">Fast</option>
          <option value="balanced">Balanced</option>
          <option value="deep">Deep</option>
        </select>
        <select value={tools} onChange={(e) => setTools(e.target.value as ToolsMode)}>
          <option value="off">Tools: Off</option>
          <option value="ask">Tools: Ask</option>
          <option value="allowed">Tools: Allowed</option>
        </select>
        {IMAGE_PERSONAS.has(persona) && (
          <>
            <select
              value={imageQuality}
              onChange={(e) => setImageQuality(e.target.value as ImageQuality)}
              title="gpt-image-2 quality"
            >
              {IMAGE_QUALITIES.map((q) => (
                <option key={q} value={q}>
                  Image quality: {q}
                </option>
              ))}
            </select>
            <select
              value={imageSize}
              onChange={(e) => setImageSize(e.target.value as ImageSize)}
              title="gpt-image-2 size"
            >
              {IMAGE_SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  Image size: {s.label}
                </option>
              ))}
            </select>
          </>
        )}
        {sending && onStop ? (
          <button onClick={onStop} style={{ background: "var(--danger)", color: "#fff" }}>
            Stop
          </button>
        ) : (
          <button onClick={onSend} disabled={!draft.trim() && !uploadedImage}>
            Send
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <button onClick={() => fileRef.current?.click()} disabled={sending} title="Upload image">
          📎
        </button>
      </div>
    </footer>
  );
}
