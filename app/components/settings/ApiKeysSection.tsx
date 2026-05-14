"use client";

import { useEffect, useState } from "react";

interface KeyState {
  value: string;
  visible: boolean;
  tested: "idle" | "testing" | "ok" | "error";
  testError?: string;
}

const STORAGE_KEYS = {
  openai: "byok.openai",
  anthropic: "byok.anthropic",
  gemini: "byok.gemini",
  ollamaUrl: "byok.ollama.url",
} as const;

export function ApiKeysSection() {
  const [keys, setKeys] = useState<Record<string, KeyState>>({
    openai: { value: "", visible: false, tested: "idle" },
    anthropic: { value: "", visible: false, tested: "idle" },
    gemini: { value: "", visible: false, tested: "idle" },
  });
  const [ollamaUrl, setOllamaUrl] = useState("");

  useEffect(() => {
    const next: Record<string, KeyState> = {};
    for (const [name, key] of Object.entries(STORAGE_KEYS)) {
      if (name === "ollamaUrl") continue;
      try {
        const v = window.localStorage.getItem(key) ?? "";
        next[name] = { value: v, visible: false, tested: "idle" };
      } catch {
        next[name] = { value: "", visible: false, tested: "idle" };
      }
    }
    setKeys(next);
    try {
      setOllamaUrl(window.localStorage.getItem(STORAGE_KEYS.ollamaUrl) ?? "");
    } catch {
      setOllamaUrl("");
    }
  }, []);

  const updateKey = (name: string, patch: Partial<KeyState>) => {
    setKeys((prev) => {
      const next = { ...prev, [name]: { ...prev[name], ...patch } };
      if (patch.value !== undefined) {
        try {
          const storageKey = STORAGE_KEYS[name as keyof typeof STORAGE_KEYS];
          if (storageKey && storageKey !== "byok.ollama.url") {
            if (patch.value) window.localStorage.setItem(storageKey, patch.value);
            else window.localStorage.removeItem(storageKey);
          }
        } catch {
          // ignore
        }
      }
      return next;
    });
  };

  const testKey = async (name: string) => {
    const state = keys[name];
    if (!state?.value.trim()) return;
    updateKey(name, { tested: "testing" });

    try {
      let ok = false;
      if (name === "openai") {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${state.value.trim()}` },
          signal: AbortSignal.timeout(5000),
        });
        ok = res.ok;
      } else if (name === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": state.value.trim(),
            "anthropic-version": "2023-06-01",
          },
          signal: AbortSignal.timeout(5000),
        });
        ok = res.ok;
      } else if (name === "gemini") {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${state.value.trim()}`,
          { signal: AbortSignal.timeout(5000) }
        );
        ok = res.ok;
      }
      updateKey(name, { tested: ok ? "ok" : "error", testError: ok ? undefined : "Invalid key or API error" });
    } catch (err) {
      updateKey(name, { tested: "error", testError: err instanceof Error ? err.message : String(err) });
    }
  };

  const clearAll = () => {
    if (!window.confirm("Clear all API keys from browser storage?")) return;
    for (const key of Object.values(STORAGE_KEYS)) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    setKeys({
      openai: { value: "", visible: false, tested: "idle" },
      anthropic: { value: "", visible: false, tested: "idle" },
      gemini: { value: "", visible: false, tested: "idle" },
    });
    setOllamaUrl("");
  };

  const saveOllamaUrl = (value: string) => {
    setOllamaUrl(value);
    try {
      if (value.trim()) window.localStorage.setItem(STORAGE_KEYS.ollamaUrl, value.trim());
      else window.localStorage.removeItem(STORAGE_KEYS.ollamaUrl);
    } catch {
      // ignore
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>API Keys</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 20 }}>
        Bring your own keys for cloud models. These are stored in your browser only and never persisted on the server.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {([
          { name: "openai", label: "OpenAI API Key", hint: "Used for GPT-4o, GPT-4o-mini, and image generation" },
          { name: "anthropic", label: "Anthropic API Key", hint: "Used for Claude 3.5 Sonnet" },
          { name: "gemini", label: "Gemini API Key", hint: "Used for Gemini 2.0 Flash" },
        ] as const).map(({ name, label, hint }) => (
          <div key={name}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              {label}
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type={keys[name]?.visible ? "text" : "password"}
                value={keys[name]?.value ?? ""}
                onChange={(e) => updateKey(name, { value: e.target.value, tested: "idle" })}
                placeholder={`Paste your ${label.toLowerCase()}`}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => updateKey(name, { visible: !keys[name]?.visible })}
                style={{ fontSize: 12 }}
              >
                {keys[name]?.visible ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                onClick={() => testKey(name)}
                disabled={!keys[name]?.value.trim() || keys[name]?.tested === "testing"}
                style={{ fontSize: 12 }}
              >
                {keys[name]?.tested === "testing" ? "Testing…" : "Test"}
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>{hint}</div>
            {keys[name]?.tested === "ok" && (
              <div style={{ fontSize: 12, color: "var(--ok)", marginTop: 4 }}>✓ Key is valid</div>
            )}
            {keys[name]?.tested === "error" && (
              <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>
                ✗ {keys[name]?.testError}
              </div>
            )}
          </div>
        ))}

        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Ollama Base URL
          </label>
          <input
            type="text"
            value={ollamaUrl}
            onChange={(e) => saveOllamaUrl(e.target.value)}
            placeholder="http://127.0.0.1:11434"
            style={{ width: "100%", maxWidth: 400 }}
          />
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
            Default is http://127.0.0.1:11434. Only change if you run Ollama on a different address.
          </div>
        </div>

        <div style={{ paddingTop: 8 }}>
          <button type="button" onClick={clearAll} style={{ color: "var(--danger)" }}>
            Clear all keys
          </button>
        </div>
      </div>
    </div>
  );
}
