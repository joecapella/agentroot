"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/apiClient";
import type { UserProfileRow } from "../../lib/types";

export function ProfileSection() {
  const [, setProfile] = useState<UserProfileRow | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [identityDocument, setIdentityDocument] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<{ profile: UserProfileRow }>("/api/profile");
        setProfile(data.profile);
        setDisplayName(data.profile.displayName);
        setEmail(data.profile.email ?? "");
        let doc = "";
        try {
          const prefs = JSON.parse(data.profile.preferencesJson || "{}");
          if (typeof prefs.identityDocument === "string") doc = prefs.identityDocument;
        } catch {
          // ignore
        }
        setIdentityDocument(doc);
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
          displayName: displayName.trim() || undefined,
          email: email.trim() || undefined,
          identityDocument: identityDocument.trim() || undefined,
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
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Identity</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 20 }}>
        Tell the agent who you are so it can personalize responses.
      </p>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Display name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Joseph"
            style={{ width: "100%", maxWidth: 320 }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ width: "100%", maxWidth: 320 }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Who I am
          </label>
          <textarea
            value={identityDocument}
            onChange={(e) => setIdentityDocument(e.target.value)}
            placeholder="I'm a full-stack developer who prefers TypeScript, Next.js, and Prisma. I work on AI tools and value concise, actionable advice."
            rows={6}
            style={{ width: "100%", resize: "vertical" }}
          />
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
            This is injected into every conversation as an identity preamble. Keep it under ~4000 characters.
          </div>
        </div>

        {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save identity"}
          </button>
          {savedAt && (
            <span style={{ color: "var(--ok)", fontSize: 12 }}>Saved at {savedAt}</span>
          )}
        </div>
      </form>
    </div>
  );
}
