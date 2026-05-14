"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/apiClient";
import type { UserProfileRow, ReasoningProfile, ToolsMode, Persona, ImageQuality, ImageSize } from "../../lib/types";

export function DefaultsSection() {
  const [, setProfile] = useState<UserProfileRow | null>(null);
  const [defaultReasoning, setDefaultReasoning] = useState<ReasoningProfile>("balanced");
  const [defaultTools, setDefaultTools] = useState<ToolsMode>("ask");
  const [defaultPersona, setDefaultPersona] = useState<Persona | "auto">("auto");
  const [defaultImageQuality, setDefaultImageQuality] = useState<ImageQuality>("auto");
  const [defaultImageSize, setDefaultImageSize] = useState<ImageSize>("auto");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<{ profile: UserProfileRow }>("/api/profile");
        setProfile(data.profile);
        setDefaultReasoning(data.profile.defaultReasoning);
        setDefaultTools(data.profile.defaultTools);
        setDefaultPersona(data.profile.defaultPersona);
        try {
          const prefs = JSON.parse(data.profile.preferencesJson || "{}");
          if (prefs.defaultImageQuality) setDefaultImageQuality(prefs.defaultImageQuality);
          if (prefs.defaultImageSize) setDefaultImageSize(prefs.defaultImageSize);
        } catch {
          // ignore
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedAt(null);
    setError(null);
    try {
      await api("/api/profile", {
        method: "PATCH",
        body: {
          defaultReasoning,
          defaultTools,
          defaultPersona,
          defaultImageQuality,
          defaultImageSize,
        },
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      if (e instanceof ApiError) setError(`${e.code} (${e.status})`);
      else setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Defaults</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 20 }}>
        Choose what the chat interface defaults to for new conversations.
      </p>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Default reasoning
          </label>
          <select value={defaultReasoning} onChange={(e) => setDefaultReasoning(e.target.value as ReasoningProfile)}>
            <option value="fast">Fast — quick answers, less depth</option>
            <option value="balanced">Balanced — the sweet spot</option>
            <option value="deep">Deep — thorough analysis and planning</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Default tools mode
          </label>
          <select value={defaultTools} onChange={(e) => setDefaultTools(e.target.value as ToolsMode)}>
            <option value="off">Off — no tool use</option>
            <option value="ask">Ask — confirm before destructive actions</option>
            <option value="allowed">Allowed — run tools freely</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Default persona
          </label>
          <select value={defaultPersona} onChange={(e) => setDefaultPersona(e.target.value as Persona | "auto")}>
            <option value="auto">Auto — pick based on message</option>
            <option value="orchestrator">Orchestrator — general coworker</option>
            <option value="code_assistant">Code Assistant — programming tasks</option>
            <option value="brand_designer">Brand Designer — creative & visual</option>
            <option value="ops">Ops — planning & organization</option>
            <option value="vision">Vision — image understanding</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Default image quality
          </label>
          <select value={defaultImageQuality} onChange={(e) => setDefaultImageQuality(e.target.value as ImageQuality)}>
            <option value="auto">Auto</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Default image size
          </label>
          <select value={defaultImageSize} onChange={(e) => setDefaultImageSize(e.target.value as ImageSize)}>
            <option value="auto">Auto</option>
            <option value="1024x1024">1024×1024</option>
            <option value="1024x1536">1024×1536</option>
            <option value="1536x1024">1536×1024</option>
          </select>
        </div>

        {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save defaults"}
          </button>
          {savedAt && (
            <span style={{ color: "var(--ok)", fontSize: 12 }}>Saved at {savedAt}</span>
          )}
        </div>
      </form>
    </div>
  );
}
