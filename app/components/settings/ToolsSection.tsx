"use client";

import { useState, useMemo } from "react";
import { useToolPolicies } from "../../lib/hooks";

const POLICY_COLORS: Record<string, string> = {
  ask: "var(--warn)",
  allowed: "var(--ok)",
  blocked: "var(--danger)",
  readonly: "var(--accent)",
};

const POLICY_LABELS: Record<string, string> = {
  ask: "Ask",
  allowed: "Allowed",
  blocked: "Blocked",
  readonly: "Read-only",
};

export function ToolsSection() {
  const { policies, save, loading, error } = useToolPolicies();
  const [localChanges, setLocalChanges] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const merged = useMemo(() => {
    return policies.map((p) => ({
      ...p,
      effectivePolicy: (localChanges[p.toolName] ?? p.policy) as "ask" | "allowed" | "blocked" | "readonly",
    }));
  }, [policies, localChanges]);

  const categories = useMemo(() => {
    const map = new Map<string, typeof merged>();
    for (const p of merged) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return map;
  }, [merged]);

  const handleChange = (toolName: string, policy: string) => {
    setLocalChanges((prev) => ({ ...prev, [toolName]: policy }));
    setSaved(false);
  };

  const handleSave = async () => {
    const updates = merged
      .filter((p) => localChanges[p.toolName] !== undefined)
      .map((p) => ({ toolName: p.toolName, policy: localChanges[p.toolName] as "ask" | "allowed" | "blocked" | "readonly" }));
    if (updates.length === 0) return;
    await save(updates);
    setLocalChanges({});
    setSaved(true);
  };

  const handleReset = () => {
    setLocalChanges({});
    setSaved(false);
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Tools & Permissions</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 20 }}>
        Control what each tool can do. Destructive tools (write_file, run_command) always require
        approval regardless of policy.
      </p>

      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {Array.from(categories.entries()).map(([category, items]) => (
          <div key={category}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--text-dim)",
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              {category}
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
              {items.map((p, idx) => (
                <div
                  key={p.toolName}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    borderBottom: idx < items.length - 1 ? "1px solid var(--border)" : undefined,
                    background: idx % 2 === 0 ? "var(--panel)" : "var(--panel-2)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.toolName}</div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 1 }}>
                      {p.description}
                    </div>
                  </div>
                  <select
                    value={p.effectivePolicy}
                    onChange={(e) => handleChange(p.toolName, e.target.value)}
                    style={{ minWidth: 110, fontSize: 12 }}
                  >
                    {Object.entries(POLICY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: POLICY_COLORS[p.effectivePolicy] ?? "#888",
                      flexShrink: 0,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 20, alignItems: "center" }}>
        <button onClick={handleSave} disabled={loading || Object.keys(localChanges).length === 0}>
          {loading ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={handleReset} disabled={loading}>
          Reset
        </button>
        {saved && <span style={{ color: "var(--ok)", fontSize: 12 }}>Saved</span>}
      </div>
    </div>
  );
}
