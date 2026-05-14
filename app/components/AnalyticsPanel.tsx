"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/apiClient";
import { drawer } from "./styles";

interface Metrics {
  days: number;
  totalMessages: number;
  totalConversations: number;
  toolUsage: Array<{ toolName: string; count: number }>;
  recentEvents: Array<{ eventType: string; payload: unknown; createdAt: string }>;
}

interface UsageSummary {
  days: number;
  totalCalls: number;
  totalCostUsd: number;
  byModel: Record<string, { prompt: number; completion: number; cost: number }>;
}

export function AnalyticsPanel({ onClose }: { onClose: () => void }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api<{ metrics: Metrics; usage: UsageSummary }>(`/api/analytics?days=${days}`)
      .then((data) => {
        setMetrics(data.metrics);
        setUsage(data.usage);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <aside style={drawer}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: 12,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <strong>Analytics</strong>
        <button onClick={onClose}>×</button>
      </div>
      <div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                background: days === d ? "var(--accent)" : undefined,
                color: days === d ? "#000" : undefined,
              }}
            >
              {d}d
            </button>
          ))}
        </div>

        {loading && <div style={{ color: "var(--text-dim)" }}>Loading…</div>}

        {metrics && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <StatGrid
              stats={[
                { label: "Messages", value: metrics.totalMessages },
                { label: "Conversations", value: metrics.totalConversations },
              ]}
            />

            {usage && (
              <StatGrid
                stats={[
                  { label: "API Calls", value: usage.totalCalls },
                  { label: "Est. Cost", value: `$${usage.totalCostUsd.toFixed(4)}` },
                ]}
              />
            )}

            <Section title="Tool Usage">
              {metrics.toolUsage.length === 0 ? (
                <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No tool usage yet.</div>
              ) : (
                metrics.toolUsage.map((t) => (
                  <div
                    key={t.toolName}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "4px 0",
                      borderBottom: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                  >
                    <span>{t.toolName}</span>
                    <span>{t.count}</span>
                  </div>
                ))
              )}
            </Section>

            {usage && Object.keys(usage.byModel).length > 0 && (
              <Section title="Cost by Model">
                {Object.entries(usage.byModel).map(([model, data]) => (
                  <div
                    key={model}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "4px 0",
                      borderBottom: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                  >
                    <span>{model}</span>
                    <span>${data.cost.toFixed(4)}</span>
                  </div>
                ))}
              </Section>
            )}

            <Section title="Recent Events">
              {metrics.recentEvents.slice(0, 20).map((e, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    color: "var(--text-dim)",
                    padding: "3px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span style={{ color: "var(--accent)" }}>{e.eventType}</span>
                  <span style={{ marginLeft: 8 }}>
                    {new Date(e.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </Section>
          </div>
        )}
      </div>
    </aside>
  );
}

function StatGrid({ stats }: { stats: Array<{ label: string; value: string | number }> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {stats.map((s) => (
        <div
          key={s.label}
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 10,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700 }}>{s.value}</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-dim)" }}>
        {title}
      </div>
      {children}
    </div>
  );
}
