"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { drawer } from "./styles";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [localFreedom, setLocalFreedom] = useState(true);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("local.tools.fullAccess");
      setLocalFreedom(saved !== "false");
    } catch {
      setLocalFreedom(true);
    }
  }, []);

  return (
    <aside style={drawer}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: 12,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <strong>Quick Settings</strong>
        <button onClick={onClose}>×</button>
      </div>

      <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Local freedom mode</div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            checked={localFreedom}
            onChange={(e) => {
              const next = e.target.checked;
              setLocalFreedom(next);
              try {
                window.localStorage.setItem("local.tools.fullAccess", next ? "true" : "false");
              } catch {
                /* ignore */
              }
            }}
          />
          Allow local models to run tools without approvals
        </label>
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
          Warning: this enables full local control including file edits and shell commands.
        </div>
      </div>

      <div style={{ padding: 12, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Full settings</div>
        <p style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>
          Configure API keys, models, personas, tools, and more.
        </p>
        <Link
          href="/settings"
          onClick={onClose}
          style={{
            display: "inline-block",
            padding: "8px 14px",
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            textDecoration: "none",
            fontSize: 13,
          }}
        >
          Open settings page →
        </Link>
      </div>
    </aside>
  );
}
