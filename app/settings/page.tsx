"use client";

import { useState } from "react";
import Link from "next/link";
import { SettingsNav } from "../components/settings/SettingsNav";
import { ProfileSection } from "../components/settings/ProfileSection";
import { ApiKeysSection } from "../components/settings/ApiKeysSection";
import { LocalAgentSection } from "../components/settings/LocalAgentSection";
import { ModelsSection } from "../components/settings/ModelsSection";
import { PersonasSection } from "../components/settings/PersonasSection";
import { ToolsSection } from "../components/settings/ToolsSection";
import { DefaultsSection } from "../components/settings/DefaultsSection";
import { DangerSection } from "../components/settings/DangerSection";

type TabKey =
  | "identity"
  | "apiKeys"
  | "localAgent"
  | "models"
  | "personas"
  | "tools"
  | "defaults"
  | "advanced";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("identity");

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Left navigation */}
      <SettingsNav active={activeTab} onSelect={setActiveTab} />

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 24px",
            borderBottom: "1px solid var(--border)",
            background: "var(--panel)",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700 }}>Settings</div>
          <Link
            href="/"
            style={{
              color: "var(--accent)",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            ← Back to chat
          </Link>
        </div>

        {/* Scrollable content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 32px",
          }}
        >
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            {activeTab === "identity" && <ProfileSection />}
            {activeTab === "apiKeys" && <ApiKeysSection />}
            {activeTab === "localAgent" && <LocalAgentSection />}
            {activeTab === "models" && <ModelsSection />}
            {activeTab === "personas" && <PersonasSection />}
            {activeTab === "tools" && <ToolsSection />}
            {activeTab === "defaults" && <DefaultsSection />}
            {activeTab === "advanced" && <DangerSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
