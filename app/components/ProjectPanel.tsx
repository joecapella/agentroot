"use client";

import { useState } from "react";
import { api } from "../lib/apiClient";
import type { ProjectWorkspace } from "../lib/hooks";
import { drawer } from "./styles";

export function ProjectPanel({
  projects,
  activeSlug,
  onSelect,
  onClose,
  onChanged,
}: {
  projects: ProjectWorkspace[];
  activeSlug: string | null;
  onSelect: (slug: string | null) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!newSlug.trim() || !newName.trim()) return;
    setCreating(true);
    try {
      await api("/api/projects", {
        method: "POST",
        body: { slug: newSlug.trim(), displayName: newName.trim() },
      });
      setNewSlug("");
      setNewName("");
      setShowCreate(false);
      onChanged();
    } catch (e) {
      alert(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <aside style={drawer}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: 12,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <strong>Projects</strong>
        <button onClick={onClose}>×</button>
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button onClick={() => onSelect(null)} disabled={activeSlug === null}>
            All
          </button>
          <button onClick={() => setShowCreate((v) => !v)}>+ New</button>
        </div>
        {showCreate && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            <input
              placeholder="slug (e.g. plimsoll)"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
            />
            <input
              placeholder="Display name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button onClick={create} disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {projects.map((p) => (
            <ProjectRow
              key={p.slug}
              project={p}
              active={activeSlug === p.slug}
              onSelect={() => onSelect(p.slug)}
              onChanged={onChanged}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function ProjectRow({
  project,
  active,
  onSelect,
  onChanged,
}: {
  project: ProjectWorkspace;
  active: boolean;
  onSelect: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [goals, setGoals] = useState(() => {
    try {
      return JSON.parse(project.goalsJson).join("\n");
    } catch {
      return "";
    }
  });
  const [pinned, setPinned] = useState(() => {
    try {
      return JSON.parse(project.pinnedPathsJson).join("\n");
    } catch {
      return "";
    }
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/projects/${encodeURIComponent(project.slug)}`, {
        method: "PATCH",
        body: {
          goalsJson: JSON.stringify(
            goals
              .split("\n")
              .map((s: string) => s.trim())
              .filter(Boolean)
          ),
          pinnedPathsJson: JSON.stringify(
            pinned
              .split("\n")
              .map((s: string) => s.trim())
              .filter(Boolean)
          ),
        },
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      alert(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 8,
        background: active ? "var(--user)" : "transparent",
        cursor: "pointer",
      }}
      onClick={onSelect}
    >
      <div style={{ fontWeight: 600 }}>{project.displayName}</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
        {project.status} · {project.slug}
      </div>
      {active && (
        <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
          {!editing ? (
            <button onClick={() => setEditing(true)}>Edit context</button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Goals (one per line)</div>
              <textarea
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                rows={3}
                style={{ background: "var(--panel)" }}
              />
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Pinned paths (one per line)</div>
              <textarea
                value={pinned}
                onChange={(e) => setPinned(e.target.value)}
                rows={2}
                style={{ background: "var(--panel)" }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
