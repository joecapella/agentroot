"use client";

import { useState } from "react";
import { useSettingsExport, useSettingsClear } from "../../lib/hooks";

export function DangerSection() {
  const { exportData, loading: exportLoading, error: exportError } = useSettingsExport();
  const { clear, loading: clearLoading, error: clearError } = useSettingsClear();
  const [confirmText, setConfirmText] = useState("");
  const [activeClear, setActiveClear] = useState<string | null>(null);
  const [cleared, setCleared] = useState<string | null>(null);

  const handleClear = async (type: "conversations" | "facts" | "executions" | "approvals" | "projects" | "all") => {
    const expected = {
      conversations: "DELETE CONVERSATIONS",
      facts: "DELETE FACTS",
      executions: "DELETE EXECUTIONS",
      approvals: "DELETE APPROVALS",
      projects: "DELETE PROJECTS",
      all: "DELETE EVERYTHING",
    }[type];

    if (confirmText.trim() !== expected) return;
    await clear(type, confirmText.trim());
    setCleared(type);
    setConfirmText("");
    setActiveClear(null);
  };

  const clearButtons: Array<{ key: "conversations" | "facts" | "executions" | "approvals" | "projects" | "all"; label: string; danger: boolean }> = [
    { key: "conversations", label: "Delete all conversations", danger: true },
    { key: "facts", label: "Delete all memory facts", danger: true },
    { key: "executions", label: "Delete tool execution log", danger: false },
    { key: "approvals", label: "Delete approvals history", danger: false },
    { key: "projects", label: "Delete all project workspaces", danger: true },
    { key: "all", label: "Reset everything to factory defaults", danger: true },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Advanced</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 20 }}>
        Export, cleanup, and reset operations.
      </p>

      {/* Export */}
      <div
        style={{
          padding: 16,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--panel)",
          marginBottom: 20,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Export data</div>
        <p style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>
          Download a JSON file containing all your conversations, facts, settings, and metadata.
        </p>
        <button onClick={exportData} disabled={exportLoading}>
          {exportLoading ? "Exporting…" : "Export all data"}
        </button>
        {exportError && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{exportError}</div>}
      </div>

      {/* Clear operations */}
      <div
        style={{
          padding: 16,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--panel)",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Danger zone</div>
        <p style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>
          These actions are irreversible. Type the confirmation phrase exactly as shown.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {clearButtons.map((btn) => (
            <div key={btn.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activeClear === btn.key ? (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 6,
                    background: "var(--panel-2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12 }}>
                    Type <strong>{btn.key === "all" ? "DELETE EVERYTHING" : `DELETE ${btn.key.toUpperCase()}`}</strong> to confirm:
                  </div>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="Type confirmation phrase"
                    style={{ width: "100%", maxWidth: 300 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handleClear(btn.key)}
                      disabled={clearLoading}
                      style={{
                        background: btn.danger ? "var(--danger)" : undefined,
                        color: btn.danger ? "#fff" : undefined,
                      }}
                    >
                      {clearLoading ? "Working…" : "Confirm delete"}
                    </button>
                    <button type="button" onClick={() => { setActiveClear(null); setConfirmText(""); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveClear(btn.key)}
                  style={{
                    alignSelf: "flex-start",
                    background: btn.danger ? "transparent" : undefined,
                    color: btn.danger ? "var(--danger)" : undefined,
                    border: btn.danger ? "1px solid var(--danger)" : undefined,
                  }}
                >
                  {btn.label}
                </button>
              )}
            </div>
          ))}
        </div>

        {clearError && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 12 }}>{clearError}</div>}
        {cleared && (
          <div style={{ color: "var(--ok)", fontSize: 12, marginTop: 12 }}>
            Cleared: {cleared}
          </div>
        )}
      </div>
    </div>
  );
}
