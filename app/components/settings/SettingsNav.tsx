"use client";

type TabKey =
  | "identity"
  | "apiKeys"
  | "localAgent"
  | "models"
  | "personas"
  | "tools"
  | "defaults"
  | "advanced";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "identity", label: "Identity" },
  { key: "apiKeys", label: "API Keys" },
  { key: "localAgent", label: "Local Agent" },
  { key: "models", label: "Models & Routing" },
  { key: "personas", label: "Personas" },
  { key: "tools", label: "Tools & Permissions" },
  { key: "defaults", label: "Defaults" },
  { key: "advanced", label: "Advanced" },
];

export function SettingsNav({
  active,
  onSelect,
}: {
  active: TabKey;
  onSelect: (key: TabKey) => void;
}) {
  return (
    <nav
      style={{
        width: 220,
        minWidth: 220,
        background: "var(--panel)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: "16px 0",
      }}
    >
      <div
        style={{
          padding: "0 16px 12px",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          color: "var(--text-dim)",
          letterSpacing: 0.5,
        }}
      >
        Configuration
      </div>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onSelect(tab.key)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 16px",
              background: isActive ? "var(--panel-2)" : "transparent",
              border: "none",
              borderLeft: isActive ? "3px solid var(--accent)" : "3px solid transparent",
              color: isActive ? "var(--text)" : "var(--text-dim)",
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = "var(--bg)";
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = "transparent";
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
