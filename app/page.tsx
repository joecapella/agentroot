"use client";

import { useMemo, useState } from "react";
import { ActivityPanel } from "./components/ActivityPanel";
import { ChatInput } from "./components/ChatInput";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { MemoryPanel } from "./components/MemoryPanel";
import { MessageThread } from "./components/MessageThread";
import { SettingsPanel } from "./components/SettingsPanel";

import {
  useConversationDetail,
  useConversations,
  useFacts,
  useProjects,
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
  const [reasoning, setReasoning] = useState<ReasoningProfile>("balanced");
  const [tools, setTools] = useState<ToolsMode>("ask");
  const [persona, setPersona] = useState<Persona | "auto">("auto");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("auto");
  const [imageSize, setImageSize] = useState<ImageSize>("auto");
  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showMemory, setShowMemory] = useState(false);

  const { items: convs, reload: reloadConvs, error: convsError } =
    useConversations(projectFilter);
  const { detail, reload: reloadDetail, error: detailError } =
    useConversationDetail(activeId);
  const { send, sending, error: sendError } = useSendMessage();
  const { items: facts, reload: reloadFacts } = useFacts();
  // Bug-4: project list comes from a dedicated endpoint that scans ALL of
  // the caller's conversations (not just the latest 100 fetched for the
  // sidebar list).
  const { projects: serverProjects, reload: reloadProjects } = useProjects();

  // Defensive fallback: union the server list with whatever projects are
  // visible in the currently-loaded conversations. Keeps the dropdown
  // responsive even if the projects endpoint is briefly slow.
  const projects = useMemo(() => {
    const s = new Set<string>(serverProjects);
    for (const c of convs) if (c.project) s.add(c.project);
    return Array.from(s).sort();
  }, [convs, serverProjects]);

  const onSend = async () => {
    const message = draft.trim();
    if (!message) return;
    // Only forward image options when they are not the default `auto` —
    // keeps request bodies minimal and lets the backend distinguish "user
    // explicitly picked" from "fell through to model default".
    const result = await send({
      conversationId: activeId ?? undefined,
      message,
      reasoningProfile: reasoning,
      toolsMode: tools,
      persona: persona === "auto" ? undefined : persona,
      project: !activeId && projectFilter ? projectFilter : undefined,
      imageQuality: imageQuality === "auto" ? undefined : imageQuality,
      imageSize: imageSize === "auto" ? undefined : imageSize,
    });
    if (result) {
      setDraft("");
      if (result.conversation.id !== activeId) {
        setActiveId(result.conversation.id);
      } else {
        await reloadDetail();
      }
      await reloadConvs();
      // Project may be newly introduced on this turn — refresh the filter list.
      if (result.conversation.project) await reloadProjects();
    }
  };

  const error = convsError || detailError || sendError;

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
      />

      <main style={mainStyle}>
        <header style={header}>
          <div>
            <div style={{ fontSize: 14 }}>
              {detail?.title ?? (activeId ? "Loading…" : "New conversation")}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {detail?.project ?? ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowMemory((v) => !v)}>
              {showMemory ? "Hide memory" : "Memory"}
            </button>
            <button onClick={() => setShowActivity((v) => !v)}>
              {showActivity ? "Hide activity" : "Activity"}
            </button>
          </div>
        </header>

        <MessageThread messages={detail?.messages ?? []} />

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
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
