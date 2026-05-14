"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/apiClient";

const ALLOWED_FILES = [
  "orchestrator.prompt.md",
  "code-assistant.prompt.md",
  "brand-designer.prompt.md",
  "ops-agent.prompt.md",
  "vision-agent.prompt.md",
];

const FILE_LABELS: Record<string, string> = {
  "orchestrator.prompt.md": "Orchestrator",
  "code-assistant.prompt.md": "Code Assistant",
  "brand-designer.prompt.md": "Brand Designer",
  "ops-agent.prompt.md": "Ops Agent",
  "vision-agent.prompt.md": "Vision Agent",
};

function BakeButton() {
  const [baking, setBaking] = useState(false);
  const [bakedAt, setBakedAt] = useState<string | null>(null);
  const [bakeError, setBakeError] = useState<string | null>(null);

  const bake = async () => {
    setBaking(true);
    setBakedAt(null);
    setBakeError(null);
    try {
      const res = await api<{ baked: boolean; note: string; copied: string[] }>("/api/settings/bake", {
        method: "POST",
      });
      if (res.baked) setBakedAt(`Baked ${res.copied.length} files`);
    } catch (e) {
      setBakeError(String(e));
    } finally {
      setBaking(false);
    }
  };

  return (
    <>
      <button onClick={bake} disabled={baking} type="button" style={{ fontSize: 12 }}>
        {baking ? "Baking…" : "Bake into container"}
      </button>
      {bakedAt && <span style={{ color: "var(--ok)", fontSize: 12 }}>{bakedAt}</span>}
      {bakeError && <span style={{ color: "var(--danger)", fontSize: 12 }}>{bakeError}</span>}
    </>
  );
}

export function PersonasSection() {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string>(ALLOWED_FILES[0]);
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
      if (e instanceof ApiError) setError(`${e.code} (${e.status})`);
      else setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const content = files[activeFile] ?? "";
  const sizeBytes = new TextEncoder().encode(content).length;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Personas</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 20 }}>
        Edit the system prompts for each sub-agent. Changes are saved to{" "}
        <code>agent-config/</code> and take effect immediately for local use. Bake them to deploy to
        the hosted container.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <select
          value={activeFile}
          onChange={(e) => setActiveFile(e.target.value)}
          style={{ minWidth: 200 }}
        >
          {ALLOWED_FILES.map((f) => (
            <option key={f} value={f}>
              {FILE_LABELS[f] ?? f}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {(sizeBytes / 1024).toFixed(1)} KB / 200 KB
        </span>
      </div>

      <textarea
        value={content}
        onChange={(e) => setFiles({ ...files, [activeFile]: e.target.value })}
        rows={20}
        style={{
          width: "100%",
          fontFamily: "monospace",
          fontSize: 13,
          lineHeight: 1.5,
          resize: "vertical",
        }}
      />

      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{error}</div>}

      <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save prompt"}
        </button>
        <BakeButton />
        {savedAt && <span style={{ color: "var(--ok)", fontSize: 12 }}>Saved at {savedAt}</span>}
      </div>
    </div>
  );
}
