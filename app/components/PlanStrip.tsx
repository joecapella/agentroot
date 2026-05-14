"use client";

/**
 * PlanStrip — persistent task checklist for the active conversation.
 *
 * Surfaces the `Plan` / `PlanStep` data model the backend has been writing
 * but the UI was previously ignoring. When the agent is executing a 5-step
 * workflow, this strip ticks each step from `pending` → `running` →
 * `completed`/`failed` so Joseph can see progress at a glance — same UX
 * shape as Claude Code's todo list / Cursor's task strip.
 *
 * Stateless other than collapse: data flows down from `usePlans`.
 */

import { useState } from "react";
import type { PlanRow, PlanStepRow, PlanStepStatus } from "../lib/types";

const STATUS_ICON: Record<PlanStepStatus, string> = {
  pending: "○",
  running: "◐",
  completed: "✓",
  failed: "✗",
  skipped: "—",
};

const STATUS_COLOR: Record<PlanStepStatus, string> = {
  pending: "var(--text-dim, #888)",
  running: "var(--accent, #5b9eff)",
  completed: "#3aa757",
  failed: "#d2484f",
  skipped: "var(--text-dim, #888)",
};

export function PlanStrip({
  plans,
  loading,
  onRefresh,
}: {
  plans: PlanRow[];
  loading?: boolean;
  onRefresh?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const active = plans.filter(
    (p) => p.status === "running" || p.status === "draft",
  );
  // Show the most recent completed/failed plan too so the user can review
  // what just happened.
  const recent = plans
    .filter((p) => p.status === "completed" || p.status === "failed")
    .slice(0, 1);
  const shown = [...active, ...recent];

  if (shown.length === 0 && !loading) return null;

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border, #2a2a2a)",
        background: "var(--panel, #181818)",
        fontSize: 13,
      }}
      data-testid="plan-strip"
    >
      <div
        style={{
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "left",
            padding: 0,
            background: "transparent",
            border: 0,
            color: "var(--text, #ddd)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
          }}
          aria-expanded={!collapsed}
        >
          <span style={{ opacity: 0.6 }}>{collapsed ? "▸" : "▾"}</span>
          <span style={{ fontWeight: 600 }}>Plan</span>
          {shown[0] && (
            <span
              style={{
                color: "var(--text-dim, #888)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              · {shown[0].title}
            </span>
          )}
        </button>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            style={{
              padding: "2px 6px",
              border: 0,
              borderRadius: 4,
              background: "transparent",
              fontSize: 11,
              lineHeight: 1,
              color: "var(--text-dim, #888)",
              cursor: "pointer",
            }}
            aria-label="Refresh plan"
          >
            ↻
          </button>
        )}
      </div>

      {!collapsed && (
        <div style={{ padding: "4px 14px 12px" }}>
          {shown.map((plan) => (
            <PlanGroup key={plan.id} plan={plan} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanGroup({ plan }: { plan: PlanRow }) {
  const completedCount = plan.steps.filter((s) => s.status === "completed").length;
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--text-dim, #888)",
          marginBottom: 4,
        }}
      >
        <span>{plan.title}</span>
        <span>
          {completedCount}/{plan.steps.length} ·{" "}
          <span
            style={{
              color:
                plan.status === "completed"
                  ? "#3aa757"
                  : plan.status === "failed"
                    ? "#d2484f"
                    : plan.status === "running"
                      ? "var(--accent, #5b9eff)"
                      : "var(--text-dim, #888)",
            }}
          >
            {plan.status}
          </span>
        </span>
      </div>
      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {plan.steps.map((s) => (
          <StepRow key={s.id} step={s} />
        ))}
      </ol>
    </div>
  );
}

function StepRow({ step }: { step: PlanStepRow }) {
  return (
    <li
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        padding: "2px 0",
        lineHeight: 1.4,
      }}
    >
      <span
        style={{
          color: STATUS_COLOR[step.status],
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          minWidth: 14,
          display: "inline-block",
        }}
        aria-label={`step ${step.stepNumber} ${step.status}`}
      >
        {STATUS_ICON[step.status]}
      </span>
      <span
        style={{
          color:
            step.status === "completed"
              ? "var(--text-dim, #888)"
              : "var(--text, #ddd)",
          textDecoration: step.status === "completed" ? "line-through" : "none",
          flex: 1,
        }}
      >
        {step.description}
        {step.toolName && (
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              color: "var(--text-dim, #888)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {step.toolName}
          </span>
        )}
      </span>
    </li>
  );
}
