"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/apiClient";
import { drawer } from "./styles";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string>("orchestrator.prompt.md");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const d = await api<{ files: Record<string, string> }>("/api/settings");
        setFiles(d.files ?? {});
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setSavedAt(null);
    setError(null);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: { file: activeFile, content: files[activeFile] ?? "" },
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside style={drawer}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: 12, borderBottom: "1px solid var(--border)" }}>
        <strong>Settings — persona prompts</strong>
        <button onClick={onClose}>×</button>
      </div>
      <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
        <select
          value={activeFile}
          onChange={(e) => setActiveFile(e.target.value)}
          style={{ width: "100%" }}
        >
          {Object.keys(files).map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
          Saving writes to <code>agent-config/</code>. The hosted agent picks up
          changes on the next <code>azd up</code>.
        </div>
      </div>
      <textarea
        value={files[activeFile] ?? ""}
        onChange={(e) => setFiles({ ...files, [activeFile]: e.target.value })}
        style={{
          flex: 1,
          minHeight: 240,
          border: "none",
          borderRadius: 0,
          padding: 12,
          background: "var(--panel)",
        }}
      />
      <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
        <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        {savedAt && (
          <span style={{ color: "var(--ok)", fontSize: 12, alignSelf: "center" }}>
            Saved at {savedAt}
          </span>
        )}
        {error && (
          <span style={{ color: "var(--danger)", fontSize: 12, alignSelf: "center" }}>{error}</span>
        )}
      </div>
    </aside>
  );
}
