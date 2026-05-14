"use client";

import { useEffect, useState, useCallback } from "react";
import {
  detectOllama,
  listOllamaModels,
  pullOllamaModel,
  CURATED_OLLAMA_MODELS,
  getDefaultOllamaModel,
  setDefaultOllamaModel,
} from "../../lib/ollamaClient";
import type { OllamaModel } from "../../lib/ollamaClient";

export function LocalAgentSection() {
  const [status, setStatus] = useState<{ reachable: boolean; version?: string; error?: string }>({
    reachable: false,
  });
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [localFreedom, setLocalFreedom] = useState(true);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<string>("");

  const load = useCallback(async () => {
    const detect = await detectOllama();
    setStatus(detect);
    if (detect.reachable) {
      try {
        const list = await listOllamaModels();
        setModels(list);
      } catch {
        setModels([]);
      }
    }
    setDefaultModel(getDefaultOllamaModel());
    try {
      setLocalFreedom(window.localStorage.getItem("local.tools.fullAccess") !== "false");
    } catch {
      setLocalFreedom(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePull = async (tag: string) => {
    setPulling(tag);
    setPullProgress("");
    try {
      const stream = pullOllamaModel(tag);
      for await (const ev of stream) {
        setPullProgress(ev.status);
      }
      await load();
    } catch (err) {
      setPullProgress(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(null);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Local Agent</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 20 }}>
        Run models locally with Ollama. Your prompts stay on your machine.
      </p>

      {/* Status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderRadius: 6,
          background: "var(--panel-2)",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: status.reachable ? "var(--ok)" : "var(--danger)",
          }}
        />
        <span style={{ fontSize: 13 }}>
          {status.reachable
            ? `Ollama reachable ${status.version ? `(${status.version})` : ""}`
            : status.error || "Ollama not reachable"}
        </span>
        <button type="button" onClick={() => load()} style={{ marginLeft: "auto", fontSize: 12 }}>
          Refresh
        </button>
      </div>

      {/* Default model */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          Default local model
        </label>
        <select
          value={defaultModel ?? ""}
          onChange={(e) => {
            const v = e.target.value || null;
            setDefaultModel(v);
            setDefaultOllamaModel(v);
          }}
          style={{ width: "100%", maxWidth: 400 }}
        >
          <option value="">— None —</option>
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
          When a default model is set, new messages are routed to Ollama first.
        </div>
      </div>

      {/* Local freedom mode */}
      <div
        style={{
          padding: 14,
          borderRadius: 6,
          background: "var(--panel-2)",
          marginBottom: 20,
        }}
      >
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
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
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Local freedom mode</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
              Allow local models to run tools (including file edits and shell commands) without
              approvals. Only enable if you fully trust your local setup.
            </div>
          </div>
        </label>
      </div>

      {/* Curated models */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Recommended models</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {CURATED_OLLAMA_MODELS.map((m) => {
            const installed = models.some((inst) => inst.name === m.tag);
            return (
              <div
                key={m.tag}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  background: "var(--panel-2)",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                  {m.sizeGB} GB · {m.hint}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  {installed ? (
                    <span style={{ fontSize: 12, color: "var(--ok)" }}>✓ Installed</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handlePull(m.tag)}
                      disabled={pulling === m.tag}
                      style={{ fontSize: 12 }}
                    >
                      {pulling === m.tag ? "Pulling…" : "Pull"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {pullProgress && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>{pullProgress}</div>
        )}
      </div>
    </div>
  );
}
