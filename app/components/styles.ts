import type { CSSProperties } from "react";

export const layout: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "280px 1fr",
  height: "100vh",
  width: "100vw",
};

export const sidebar: CSSProperties = {
  borderRight: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  background: "var(--panel)",
};

export const main: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
};

export const header: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
};

export const scroller: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "16px 18px",
};

export const footer: CSSProperties = {
  borderTop: "1px solid var(--border)",
  padding: 12,
  display: "flex",
  gap: 10,
  alignItems: "stretch",
};

export const drawer: CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  width: 380,
  height: "100vh",
  background: "var(--panel)",
  borderLeft: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  zIndex: 50,
};

export function statusColor(s: string): string {
  if (s === "COMPLETED") return "var(--ok)";
  if (s === "FAILED" || s === "CANCELED") return "var(--danger)";
  if (s === "AWAITING_APPROVAL") return "var(--warn)";
  return "var(--accent)";
}

// ── Mobile responsive overrides (injected via media query in page) ──────────

export const mobileLayout: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gridTemplateRows: "auto 1fr auto",
  height: "100vh",
  width: "100vw",
};

export const mobileSidebarOverlay: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "80vw",
  maxWidth: 300,
  height: "100vh",
  background: "var(--panel)",
  borderRight: "1px solid var(--border)",
  zIndex: 60,
  display: "flex",
  flexDirection: "column",
};

export const mobileDrawer: CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  width: "90vw",
  maxWidth: 400,
  height: "100vh",
  background: "var(--panel)",
  borderLeft: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  zIndex: 50,
};

// ── Memory panel styles ────────────────────────────────────────────────────

export const memoryHeader: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
};

export const memoryToolbar: CSSProperties = {
  padding: "10px 14px",
  display: "flex",
  gap: 8,
};

export const memoryList: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "0 14px 14px 14px",
};

export const memoryCard: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
  marginBottom: 10,
  background: "var(--bg)",
};

export const memoryCardHeader: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

export const memoryCardTags: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

export const memoryTag: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
};

export const memoryCardTitle: CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  marginTop: 4,
};

export const memoryCardBody: CSSProperties = {
  fontSize: 12,
  color: "var(--text-dim)",
  marginTop: 2,
  whiteSpace: "pre-wrap",
};

export const memoryForm: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 12,
  background: "var(--bg)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

export const memoryFormRow: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

export const memoryError: CSSProperties = {
  color: "var(--danger)",
  fontSize: 12,
  marginTop: 4,
};
