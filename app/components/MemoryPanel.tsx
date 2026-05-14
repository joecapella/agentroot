"use client";

import { useState } from "react";
import { api, ApiError } from "../lib/apiClient";
import type { FactCategory, FactRow } from "../lib/types";
import {
  drawer,
  memoryCard,
  memoryCardBody,
  memoryCardHeader,
  memoryCardTags,
  memoryCardTitle,
  memoryError,
  memoryForm,
  memoryFormRow,
  memoryHeader,
  memoryList,
  memoryTag,
  memoryToolbar,
} from "./styles";

const CATEGORY_LABELS: Record<FactCategory, string> = {
  preference: "Preference",
  constraint: "Constraint",
  project_knowledge: "Project",
  lesson_learned: "Lesson",
  identity: "Identity",
};

const CATEGORY_COLORS: Record<FactCategory, string> = {
  preference: "var(--accent)",
  constraint: "var(--danger)",
  project_knowledge: "var(--ok)",
  lesson_learned: "var(--warn)",
  identity: "#888",
};

export function MemoryPanel({
  facts,
  onClose,
  onFactChanged,
}: {
  facts: FactRow[];
  onClose: () => void;
  onFactChanged: () => void;
}) {
  const [category, setCategory] = useState<FactCategory | "">("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = facts
    .filter((f) => (category ? f.category === category : true))
    .filter(
      (f) =>
        search === "" ||
        f.label.toLowerCase().includes(search.toLowerCase()) ||
        f.fullText.toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div style={drawer}>
      <div style={memoryHeader}>
        <div style={{ fontWeight: 700 }}>Memory — what I know</div>
        <button onClick={onClose}>Close</button>
      </div>

      {error && (
        <div style={memoryError}>{error}</div>
      )}

      <div style={memoryToolbar}>
        <input
          type="text"
          placeholder="Search memory…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as FactCategory | "")}
          style={{ width: 130 }}
        >
          <option value="">All</option>
          {(Object.keys(CATEGORY_LABELS) as FactCategory[]).map((k) => (
            <option key={k} value={k}>
              {CATEGORY_LABELS[k]}
            </option>
          ))}
        </select>
        <button onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "+"}
        </button>
      </div>

      {adding && (
        <div style={{ padding: "0 14px 10px 14px" }}>
          <FactForm
            onDone={() => {
              setError(null);
              onFactChanged();
              setAdding(false);
            }}
            onError={setError}
            onClose={() => setAdding(false)}
          />
        </div>
      )}

      <div style={memoryList}>
        {filtered.length === 0 && (
          <div style={{ color: "var(--text-dim)", marginTop: 16 }}>
            {facts.length === 0
              ? "Nothing remembered yet. Use the + button to add a fact, or ask the agent to remember something."
              : "No matches."}
          </div>
        )}
        {filtered.map((f) => (
          <FactCard
            key={f.id}
            fact={f}
            onChanged={() => {
              setError(null);
              onFactChanged();
            }}
            onError={setError}
          />
        ))}
      </div>
    </div>
  );
}

function FactCard({
  fact,
  onChanged,
  onError,
}: {
  fact: FactRow;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api(`/api/facts/${fact.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) {
        onError(`Delete failed: ${err.code} (${err.status})`);
      } else {
        onError("Delete failed — see console");
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={memoryCard}>
      {editing ? (
        <FactForm
          initial={fact}
          onDone={() => {
            onChanged();
            setEditing(false);
          }}
          onError={onError}
          onClose={() => setEditing(false)}
        />
      ) : (
        <>
          <div style={memoryCardHeader}>
            <div style={memoryCardTags}>
              <span
                style={{
                  ...memoryTag,
                  color:
                    CATEGORY_COLORS[fact.category as FactCategory] || "#888",
                }}
              >
                {CATEGORY_LABELS[fact.category as FactCategory] ??
                  fact.category}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                imp:{fact.importance}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setEditing(true)}
                style={{ fontSize: 11 }}
              >
                Edit
              </button>
              <button
                onClick={doDelete}
                disabled={deleting}
                style={{ fontSize: 11 }}
              >
                {deleting ? "…" : "×"}
              </button>
            </div>
          </div>
          <div style={memoryCardTitle}>{fact.label}</div>
          <div style={memoryCardBody}>{fact.fullText}</div>
        </>
      )}
    </div>
  );
}

function FactForm({
  initial,
  onDone,
  onError,
  onClose,
}: {
  initial?: FactRow;
  onDone: () => void;
  onError: (msg: string) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<FactCategory>(
    (initial?.category as FactCategory) ?? "preference"
  );
  const [label, setLabel] = useState(initial?.label ?? "");
  const [fullText, setFullText] = useState(initial?.fullText ?? "");
  const [importance, setImportance] = useState(initial?.importance ?? 5);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !fullText.trim()) return;
    setSaving(true);
    try {
      if (initial) {
        await api(`/api/facts/${initial.id}`, {
          method: "PATCH",
          body: {
            category,
            label,
            fullText,
            importance,
          },
        });
      } else {
        await api("/api/facts", {
          method: "POST",
          body: { category, label, fullText, importance },
        });
      }
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        onError(`Save failed: ${err.code} (${err.status})`);
      } else {
        onError("Save failed — see console");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} style={memoryForm}>
      <input
        type="text"
        placeholder="Short label (e.g., 'Never Lighthouse for brand')"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        required
      />
      <textarea
        placeholder="Full text — what the agent should remember"
        rows={3}
        value={fullText}
        onChange={(e) => setFullText(e.target.value)}
        required
        style={{ resize: "vertical" }}
      />
      <div style={memoryFormRow}>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as FactCategory)}
        >
          {(Object.keys(CATEGORY_LABELS) as FactCategory[]).map((k) => (
            <option key={k} value={k}>
              {CATEGORY_LABELS[k]}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={10}
          value={importance}
          onChange={(e) => setImportance(Number(e.target.value))}
          style={{ width: 60 }}
        />
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : initial ? "Update" : "Save"}
        </button>
      </div>
    </form>
  );
}
