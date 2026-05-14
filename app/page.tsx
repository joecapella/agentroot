"use client";

import { useEffect, useMemo, useState } from "react";
import { ActivityPanel } from "./components/ActivityPanel";
import { ChatInput } from "./components/ChatInput";
import { CommandPalette } from "./components/CommandPalette";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { MemoryPanel } from "./components/MemoryPanel";
import { MessageThread } from "./components/MessageThread";
import { OllamaPanel } from "./components/OllamaPanel";
import { PlanStrip } from "./components/PlanStrip";
import { ProjectPanel } from "./components/ProjectPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { AnalyticsPanel } from "./components/AnalyticsPanel";

import {
  useConversationDetail,
  useConversations,
  useFacts,
  usePlans,
  useProjectWorkspaces,
  useProjects,
  useRegenerateTitle,
  useResolveApproval,
  useRollbacks,
  useSendMessage,
} from "./lib/hooks";
import type {
  ImageQuality,
  ImageSize,
  Persona,
  ReasoningProfile,
  ToolsMode,
} from "./lib/types";
import { header, layout, main as mainStyle } from "./components/styles";

export default function Page() {
  return <ChatPage />;
}

function ChatPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [reasoning, setReasoning] = useState<ReasoningProfile>("balanced");
  const [tools, setTools] = useState<ToolsMode>("allowed");
  const [persona, setPersona] = useState<Persona | "auto">("auto");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("auto");
  const [imageSize, setImageSize] = useState<ImageSize>("auto");
  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<{ base64: string; mime: string } | null>(null);

  const { items: convs, reload: reloadConvs, error: convsError } =
    useConversations(projectFilter, searchQuery);
  const { detail, reload: reloadDetail, error: detailError } =
    useConversationDetail(activeId);
  const { send, sending, error: sendError, streamState, abort, handleLocalApproval } = useSendMessage();
  const { items: facts, reload: reloadFacts } = useFacts();
  const { projects: serverProjects, reload: reloadProjects } = useProjects();
  const { items: workspaces, reload: reloadWorkspaces } = useProjectWorkspaces();
  const { regenerate: regenerateTitle } = useRegenerateTitle();
  const { resolve: resolveApproval, error: approvalError } = useResolveApproval();
  const { restore: restoreRollback, error: rollbackError } = useRollbacks();
  const {
    plans,
    reload: reloadPlans,
    loading: plansLoading,
  } = usePlans({ conversationId: activeId });

  const projects = useMemo(() => {
    const s = new Set<string>(serverProjects);
    for (const c of convs) if (c.project) s.add(c.project);
    return Array.from(s).sort();
  }, [convs, serverProjects]);

  const pendingMessage = useMemo(() => {
    if (!sending) return null;

    if (streamState.partialMessage?.text) {
      return {
        text: streamState.partialMessage.text,
        persona: streamState.partialMessage.persona ?? (persona === "auto" ? null : persona),
      };
    }

    let text = streamState.status ?? "Thinking…";
    if (streamState.status === "generating_images") {
      const prog = streamState.imageProgress;
      text = prog
        ? `Generating image ${prog.current} of ${prog.total}…`
        : "Generating images…";
    } else if (streamState.toolCalls.length > 0) {
      const last = streamState.toolCalls[streamState.toolCalls.length - 1];
      text = `Running ${last.name}…`;
    } else if (streamState.approvalsRequired.length > 0) {
      const last = streamState.approvalsRequired[streamState.approvalsRequired.length - 1];
      text = `Approval required: ${last.name}`;
    } else if (streamState.status) {
      text = streamState.status.charAt(0).toUpperCase() + streamState.status.slice(1) + "…";
    }

    return {
      text,
      persona: persona === "auto" ? null : persona,
    };
  }, [sending, streamState, persona]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowPalette(false);
        setShowSettings(false);
        setShowActivity(false);
        setShowMemory(false);
        setShowProjects(false);
        setShowAnalytics(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const onSend = async () => {
    const message = draft.trim();
    if (!message) return;
    const result = await send({
      conversationId: activeId ?? undefined,
      message,
      reasoningProfile: reasoning,
      toolsMode: tools,
      persona: persona === "auto" ? undefined : persona,
      project: !activeId && projectFilter ? projectFilter : undefined,
      imageQuality: imageQuality === "auto" ? undefined : imageQuality,
      imageSize: imageSize === "auto" ? undefined : imageSize,
      imageBase64: uploadedImage?.base64 ?? undefined,
    });
    if (result) {
      setDraft("");
      setUploadedImage(null);
      if (result.conversation.id !== activeId) {
        setActiveId(result.conversation.id);
      } else {
        await reloadDetail();
      }
      await reloadConvs();
      if (result.conversation.project) await reloadProjects();

      // Auto-regenerate title on first assistant response
      const msgCount = detail?.messages.length ?? 0;
      if (msgCount <= 2) {
        try {
          await regenerateTitle(result.conversation.id);
          await reloadConvs();
        } catch {
          /* non-critical */
        }
      }
    }
  };

  const error = convsError || detailError || sendError || approvalError || rollbackError;

  return (
    <div style={layout}>
      <ConversationSidebar
        items={convs}
        activeId={activeId}
        onSelect={setActiveId}
        projects={projects}
        projectFilter={projectFilter}
        onProjectFilter={setProjectFilter}
        onOpenSettings={() => setShowSettings(true)}
        searchQuery={searchQuery}
        onSearchQuery={setSearchQuery}
      />

      <main style={mainStyle}>
        <header style={header}>
          <div>
            <div style={{ fontSize: 14 }}>
              {detail?.title ?? (activeId ? "Loading…" : "New conversation")}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {detail?.project ?? ""}
              {streamState.loopCount > 0 && ` · loop ${streamState.loopCount}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowProjects((v) => !v)}>
              {showProjects ? "Hide projects" : "Projects"}
            </button>
            <button onClick={() => setShowMemory((v) => !v)}>
              {showMemory ? "Hide memory" : "Memory"}
            </button>
            <button onClick={() => setShowActivity((v) => !v)}>
              {showActivity ? "Hide activity" : "Activity"}
            </button>
            <button onClick={() => setShowAnalytics((v) => !v)}>
              {showAnalytics ? "Hide analytics" : "Analytics"}
            </button>
          </div>
        </header>

        {/* Onboarding banner: shows install hint if Ollama is missing,
            model picker if Ollama is reachable but no default chosen,
            auto-hides once a default is set. */}
        <OllamaPanel mode="onboarding" />

        <PlanStrip plans={plans} loading={plansLoading} onRefresh={reloadPlans} />

        <MessageThread
          messages={detail?.messages ?? []}
          pending={pendingMessage}
          streamState={sending ? streamState : null}
          onApprove={async (id) => {
            try {
              await resolveApproval(id, "approved");
              await handleLocalApproval?.(id);
            } catch (err) {
              console.error("Approval failed:", err);
            }
          }}
          onReject={async (id) => {
            try {
              await resolveApproval(id, "rejected");
            } catch (err) {
              console.error("Rejection failed:", err);
            }
          }}
          onUndo={async (snapshotDir) => {
            try {
              await restoreRollback(snapshotDir);
              await reloadDetail();
            } catch (err) {
              console.error("Undo failed:", err);
            }
          }}
        />

        {error && (
          <div style={{ padding: "8px 14px", color: "var(--danger)" }}>
            Error: {error}
          </div>
        )}

        <ChatInput
          draft={draft}
          setDraft={setDraft}
          reasoning={reasoning}
          setReasoning={setReasoning}
          tools={tools}
          setTools={setTools}
          persona={persona}
          setPersona={setPersona}
          imageQuality={imageQuality}
          setImageQuality={setImageQuality}
          imageSize={imageSize}
          setImageSize={setImageSize}
          sending={sending}
          onSend={onSend}
          onStop={abort}
          onImageUpload={(base64, mime) => setUploadedImage({ base64, mime })}
          uploadedImage={uploadedImage}
          onClearImage={() => setUploadedImage(null)}
        />
      </main>

      {showActivity && detail && (
        <ActivityPanel
          tasks={detail.tasks}
          onClose={() => setShowActivity(false)}
          onTaskChanged={reloadDetail}
        />
      )}
      {showMemory && (
        <MemoryPanel
          facts={facts}
          onClose={() => setShowMemory(false)}
          onFactChanged={reloadFacts}
        />
      )}
      {showProjects && (
        <ProjectPanel
          projects={workspaces}
          activeSlug={projectFilter || null}
          onSelect={(slug) => {
            setProjectFilter(slug ?? "");
            setShowProjects(false);
          }}
          onClose={() => setShowProjects(false)}
          onChanged={reloadWorkspaces}
        />
      )}
      {showPalette && (
        <CommandPalette
          open={showPalette}
          onClose={() => setShowPalette(false)}
          persona={persona}
          onPersona={setPersona}
          projectFilter={projectFilter}
          onProjectFilter={setProjectFilter}
          projects={projects}
          onOpenSettings={() => { setShowPalette(false); setShowSettings(true); }}
          onOpenMemory={() => { setShowPalette(false); setShowMemory(true); }}
          onOpenActivity={() => { setShowPalette(false); setShowActivity(true); }}
          onOpenProjects={() => { setShowPalette(false); setShowProjects(true); }}
        />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showAnalytics && <AnalyticsPanel onClose={() => setShowAnalytics(false)} />}
    </div>
  );
}
