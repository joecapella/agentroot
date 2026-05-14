"use client";

import { useEffect, useRef, useState } from "react";
import type { Persona } from "../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  persona: Persona | "auto";
  onPersona: (p: Persona | "auto") => void;
  projectFilter: string;
  onProjectFilter: (p: string) => void;
  projects: string[];
  onOpenSettings: () => void;
  onOpenMemory: () => void;
  onOpenActivity: () => void;
  onOpenProjects: () => void;
}

const COMMANDS = [
  { id: "new-conv", label: "New conversation", shortcut: "Cmd+Shift+N" },
  { id: "settings", label: "Open settings", shortcut: "Cmd+," },
  { id: "memory", label: "Open memory panel", shortcut: "Cmd+M" },
  { id: "activity", label: "Open activity panel", shortcut: "Cmd+Shift+A" },
  { id: "projects", label: "Open projects panel", shortcut: "Cmd+Shift+P" },
];

export function CommandPalette({
  open,
  onClose,
  persona,
  onPersona,
  onOpenSettings,
  onOpenMemory,
  onOpenActivity,
  onOpenProjects,
}: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const filtered = COMMANDS.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase())
  );

  const run = (id: string) => {
    onClose();
    switch (id) {
      case "new-conv":
        window.location.reload();
        break;
      case "settings":
        onOpenSettings();
        break;
      case "memory":
        onOpenMemory();
        break;
      case "activity":
        onOpenActivity();
        break;
      case "projects":
        onOpenProjects();
        break;
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "15vh",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          width: 480,
          maxWidth: "90vw",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && filtered.length > 0) {
              run(filtered[0].id);
            }
          }}
          placeholder="Type a command…"
          style={{
            width: "100%",
            border: "none",
            borderBottom: "1px solid var(--border)",
            borderRadius: 0,
            padding: 12,
            background: "transparent",
            fontSize: 14,
          }}
        />
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          {filtered.map((c) => (
            <div
              key={c.id}
              onClick={() => run(c.id)}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "var(--panel-2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
            >
              <span>{c.label}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{c.shortcut}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 12, color: "var(--text-dim)" }}>No commands found.</div>
          )}
        </div>
      </div>
    </div>
  );
}
