"use client";

import { useMemo, useState } from "react";
import { useModelRoutingOverrides } from "../../lib/hooks";

const TASK_LABELS: Record<string, string> = {
  deep_planning: "Deep Planning",
  general_chat: "General Chat",
  fast_brainstorm: "Fast Brainstorm",
  code_repo: "Code (Repo-wide)",
  code_file: "Code (Single File)",
  brand_strategy: "Brand Strategy",
  copywriting: "Copywriting",
  personal_ops: "Personal Ops",
  vision: "Vision (Image Understanding)",
  visual: "Visual (Image Generation)",
};

export function ModelsSection() {
  const { overrides, defaults, availableModels, save, loading, error } = useModelRoutingOverrides();
  const [localOverrides, setLocalOverrides] = useState<Record<string, string | null>>({});
  const [saved, setSaved] = useState(false);

  const taskEntries = useMemo(() => Object.entries(defaults), [defaults]);

  const getDisplay = (task: string) => {
    const override = localOverrides[task] !== undefined ? localOverrides[task] : overrides[task];
    return override ?? null;
  };

  const handleChange = (task: string, model: string | null) => {
    setLocalOverrides((prev) => ({ ...prev, [task]: model }));
    setSaved(false);
  };

  const handleSave = async () => {
    const merged: Record<string, string | null> = {};
    for (const [task] of taskEntries) {
      const v = localOverrides[task] !== undefined ? localOverrides[task] : overrides[task];
      merged[task] = v ?? null;
    }
    await save(merged);
    setSaved(true);
  };

  const handleReset = () => {
    setLocalOverrides({});
    setSaved(false);
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Models & Routing</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 20 }}>
        Override which model handles each task kind. Leave as Use default to follow the built-in routing table.
      </p>

      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>Task</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>Default</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>Your Override</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>Fallback 1</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>Fallback 2</th>
            </tr>
          </thead>
          <tbody>
            {taskEntries.map(([task, route]) => {
              const current = getDisplay(task);
              return (
                <tr key={task} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 10px" }}>{TASK_LABELS[task] ?? task}</td>
                  <td style={{ padding: "8px 10px", color: "var(--text-dim)" }}>{route.defaultModel}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <select
                      value={current ?? ""}
                      onChange={(e) => handleChange(task, e.target.value || null)}
                      style={{ minWidth: 160 }}
                    >
                      <option value="">Use default</option>
                      {availableModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text-dim)" }}>{route.fallback ?? "—"}</td>
                  <td style={{ padding: "8px 10px", color: "var(--text-dim)" }}>{route.secondFallback ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 20, alignItems: "center" }}>
        <button onClick={handleSave} disabled={loading}>
          {loading ? "Saving…" : "Save overrides"}
        </button>
        <button type="button" onClick={handleReset} disabled={loading}>
          Reset all
        </button>
        {saved && <span style={{ color: "var(--ok)", fontSize: 12 }}>Saved</span>}
      </div>
    </div>
  );
}
