"use client";

import type { TaskRow } from "../lib/types";
import { useApproveOpenUrl } from "../lib/hooks";
import { drawer, statusColor } from "./styles";

interface Props {
  tasks: TaskRow[];
  onClose: () => void;
  onTaskChanged: () => void;
}

export function ActivityPanel({ tasks, onClose, onTaskChanged }: Props) {
  const { approve, pending, error } = useApproveOpenUrl();
  return (
    <aside style={drawer}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: 12, borderBottom: "1px solid var(--border)" }}>
        <strong>Activity</strong>
        <button onClick={onClose}>×</button>
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {tasks.length === 0 && (
          <div style={{ color: "var(--text-dim)", padding: 14 }}>No activity yet.</div>
        )}
        {tasks.map((t) => (
          <div key={t.id} style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13 }}>
              <span style={{ color: statusColor(t.status) }}>{t.status}</span> · {t.type}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {new Date(t.createdAt).toLocaleString()}
            </div>
            {t.summary && <div style={{ fontSize: 12, marginTop: 4 }}>{t.summary}</div>}

            {t.type === "open_url" && t.status === "AWAITING_APPROVAL" && (
              <button
                style={{ marginTop: 6 }}
                disabled={pending === t.id}
                onClick={async () => {
                  try {
                    await approve(t.id);
                    onTaskChanged();
                  } catch (err) {
                    console.error("Open URL approval failed:", err);
                  }
                }}
              >
                {pending === t.id ? "Opening…" : "Approve & open"}
              </button>
            )}
            {error && (
              <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 4 }}>
                Error: {error}
              </div>
            )}

            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: "pointer", color: "var(--text-dim)", fontSize: 11 }}>
                params
              </summary>
              <pre style={{ fontSize: 11 }}>{t.paramsJson}</pre>
            </details>
          </div>
        ))}
      </div>
    </aside>
  );
}
