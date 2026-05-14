"use client";

import type { ConversationSummary } from "../lib/types";
import { sidebar } from "./styles";

interface Props {
  items: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  projects: string[];
  projectFilter: string;
  onProjectFilter: (p: string) => void;
  onOpenSettings: () => void;
}

export function ConversationSidebar({
  items,
  activeId,
  onSelect,
  projects,
  projectFilter,
  onProjectFilter,
  onOpenSettings,
}: Props) {
  return (
    <aside style={sidebar}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>CofounderAgent</strong>
          <button onClick={onOpenSettings} title="Settings">⚙</button>
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <button style={{ flex: 1 }} onClick={() => onSelect(null)}>+ New</button>
        </div>
        <div style={{ marginTop: 8 }}>
          <select
            value={projectFilter}
            onChange={(e) => onProjectFilter(e.target.value)}
            style={{ width: "100%" }}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {items.length === 0 && (
          <div style={{ color: "var(--text-dim)", padding: 14 }}>No conversations yet.</div>
        )}
        {items.map((c) => (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              cursor: "pointer",
              background: c.id === activeId ? "var(--panel-2)" : "transparent",
            }}
          >
            <div style={{ fontSize: 14, marginBottom: 2 }}>{c.title}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {c.project ? `${c.project} · ` : ""}
              {new Date(c.lastMessageAt).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
