"use client";

import { useRef } from "react";
import type {
  ImageQuality,
  ImageSize,
  Persona,
  ReasoningProfile,
  ToolsMode,
} from "../lib/types";
import { footer } from "./styles";

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
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <footer style={footer}>
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder="Ask, plan, decide… (Cmd/Ctrl+Enter to send)"
        disabled={sending}
        style={{ flex: 1 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
        <select value={persona} onChange={(e) => setPersona(e.target.value as Persona | "auto")}>
          {PERSONAS.map((p) => (
            <option key={p.value} value={p.value}>Persona: {p.label}</option>
          ))}
        </select>
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
        <button onClick={onSend} disabled={sending || !draft.trim()}>
          {sending ? "…" : "Send"}
        </button>
      </div>
    </footer>
  );
}
