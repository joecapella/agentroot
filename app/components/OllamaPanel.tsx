"use client";

/**
 * OllamaPanel — onboarding + management UI for local Ollama.
 *
 * Three states:
 *   1. NOT REACHABLE → show one-line install commands per OS + link to
 *      official downloads. A "Re-check" button polls again. The user
 *      can dismiss this hint and use cloud BYOK instead.
 *   2. REACHABLE, no models → "Pull a recommended model" with live
 *      progress streamed from Ollama's /api/pull.
 *   3. REACHABLE, models present → pick a default model (radio list),
 *      pull more from the curated list, and see a green "Connected"
 *      badge. The selected model is what /api/chat skips for; turns go
 *      directly to local Ollama from the browser.
 *
 * Reachability detection is done by THIS component (not a global hook)
 * because Ollama state can change while the page is open (user starts
 * it, pulls a model, etc.); the panel is the only place that needs to
 * re-poll on demand.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CURATED_OLLAMA_MODELS,
  OLLAMA_STORAGE_KEYS,
  detectOllama,
  getDefaultOllamaModel,
  getOllamaBaseUrl,
  listOllamaModels,
  pullOllamaModel,
  setDefaultOllamaModel,
  type OllamaDetectResult,
  type OllamaModel,
} from "../lib/ollamaClient";

type PanelMode = "onboarding" | "settings";

export function OllamaPanel({
  mode = "settings",
  onClose,
}: {
  mode?: PanelMode;
  onClose?: () => void;
}) {
  const [detect, setDetect] = useState<OllamaDetectResult | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [defaultModel, setDefault] = useState<string | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{
    status: string;
    pct: number;
  } | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const recheck = useCallback(async () => {
    setDetecting(true);
    const result = await detectOllama();
    setDetect(result);
    if (result.reachable) {
      try {
        const installed = await listOllamaModels(result.url);
        setModels(installed);
      } catch {
        setModels([]);
      }
    }
    setDetecting(false);
  }, []);

  useEffect(() => {
    setDefault(getDefaultOllamaModel());
    try {
      setDismissed(
        window.localStorage.getItem(OLLAMA_STORAGE_KEYS.dismissed) === "true",
      );
    } catch {
      /* localStorage blocked; treat as not dismissed */
    }
    void recheck();
  }, [recheck]);

  const onPickDefault = (tag: string) => {
    setDefault(tag);
    setDefaultOllamaModel(tag);
  };

  const onPull = async (tag: string) => {
    setPulling(tag);
    setPullProgress({ status: "starting…", pct: 0 });
    setPullError(null);
    try {
      for await (const evt of pullOllamaModel(tag)) {
        const pct =
          evt.total && evt.completed
            ? Math.min(100, Math.round((evt.completed / evt.total) * 100))
            : 0;
        setPullProgress({ status: evt.status, pct });
      }
      setPullProgress({ status: "done", pct: 100 });
      // Re-list once pull completes.
      try {
        const installed = await listOllamaModels(getOllamaBaseUrl());
        setModels(installed);

        // Auto-select if this was the first model installed.
        if (installed.length === 1) {
          onPickDefault(tag);
        }
      } catch {
        /* fall through; user can refresh */
      }
    } catch (err) {
      setPullError(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(null);
    }
  };

  const dismissOnboarding = () => {
    try {
      window.localStorage.setItem(OLLAMA_STORAGE_KEYS.dismissed, "true");
    } catch {
      /* no-op */
    }
    setDismissed(true);
    onClose?.();
  };

  const installedTags = useMemo(() => new Set(models.map((m) => m.name)), [models]);

  if (mode === "onboarding" && (dismissed || (detect?.reachable && models.length > 0 && defaultModel))) {
    return null;
  }

  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 14,
        background: "var(--panel)",
        marginBottom: 12,
      }}
      aria-label="Ollama setup"
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>Local Models (Ollama)</strong>
        {detect && (
          <span
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 999,
              background: detect.reachable ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
              color: detect.reachable ? "var(--ok)" : "var(--danger)",
            }}
          >
            {detect.reachable ? `Connected · v${detect.version ?? "?"}` : "Not running"}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={recheck} disabled={detecting} style={{ fontSize: 12 }}>
          {detecting ? "Checking…" : "Re-check"}
        </button>
        {mode === "onboarding" && (
          <button
            onClick={dismissOnboarding}
            style={{ fontSize: 12 }}
            title="Use cloud providers instead"
          >
            Dismiss
          </button>
        )}
        {mode === "settings" && onClose && (
          <button onClick={onClose} style={{ fontSize: 12 }}>
            Close
          </button>
        )}
      </header>

      {/* State 1: Ollama not reachable */}
      {detect && !detect.reachable && (
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <p style={{ marginTop: 0 }}>
            Ollama isn&apos;t running at <code>{detect.url}</code>. Install it
            on your machine and the app will run all chats locally — your
            prompts never leave your computer.
          </p>
          <details>
            <summary style={{ cursor: "pointer" }}>One-line install</summary>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <Snippet
                label="macOS / Linux"
                command="curl -fsSL https://ollama.com/install.sh | sh"
              />
              <Snippet label="Windows (winget)" command="winget install Ollama.Ollama" />
              <Snippet label="macOS (Homebrew)" command="brew install ollama" />
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)" }}>
                Or download the official installer:{" "}
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noreferrer"
                >
                  ollama.com/download
                </a>
              </p>
            </div>
          </details>
          <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10 }}>
            After installing, run <code>ollama serve</code> (or just open the
            Ollama app) and click <em>Re-check</em> above.
          </p>
        </div>
      )}

      {/* State 2 + 3: reachable */}
      {detect?.reachable && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {models.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13 }}>
              No models installed yet. Pull one to get started — pick based on
              your RAM:
            </p>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13 }}>
                Installed models — pick your default for chat:
              </p>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {models.map((m) => (
                  <li key={m.name}>
                    <label
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="ollama-default"
                        checked={defaultModel === m.name}
                        onChange={() => onPickDefault(m.name)}
                      />
                      <code>{m.name}</code>
                      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                        {(m.size / 1e9).toFixed(1)} GB
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)" }}>
              Recommended pulls:
            </p>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {CURATED_OLLAMA_MODELS.map((m) => {
                const have = installedTags.has(m.tag);
                const isPulling = pulling === m.tag;
                return (
                  <li
                    key={m.tag}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      fontSize: 12,
                    }}
                  >
                    <code style={{ minWidth: 160 }}>{m.tag}</code>
                    <span style={{ color: "var(--text-dim)", flex: 1 }}>
                      {m.label} · {m.sizeGB} GB · {m.hint}
                    </span>
                    {have ? (
                      <span style={{ color: "var(--ok)", fontSize: 11 }}>installed</span>
                    ) : (
                      <button
                        onClick={() => onPull(m.tag)}
                        disabled={!!pulling}
                        style={{ fontSize: 12 }}
                      >
                        {isPulling ? "Pulling…" : "Pull"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {pullProgress && (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                {pulling ?? "pulled"}: {pullProgress.status}
                {pullProgress.pct > 0 ? ` (${pullProgress.pct}%)` : ""}
              </div>
            )}
            {pullError && (
              <div style={{ fontSize: 12, color: "var(--danger)", display: "flex", alignItems: "center", gap: 8 }}>
                Pull failed: {pullError}
                <button
                  onClick={() => {
                    if (pulling) return;
                    const lastTag = pulling || CURATED_OLLAMA_MODELS[0]?.tag;
                    if (lastTag) void onPull(lastTag);
                  }}
                  style={{ fontSize: 11 }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Snippet({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{label}</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <code
          style={{
            flex: 1,
            padding: "4px 6px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 12,
            overflow: "auto",
            whiteSpace: "nowrap",
          }}
        >
          {command}
        </code>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch {
              /* clipboard blocked; user can still select+copy */
            }
          }}
          style={{ fontSize: 11 }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
