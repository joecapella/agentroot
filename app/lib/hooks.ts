"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./apiClient";
import type {
  ConversationDetail,
  ConversationSummary,
  FactRow,
  ImageQuality,
  ImageSize,
  Persona,
  ReasoningProfile,
  ToolsMode,
  UserProfileRow,
} from "./types";

export function useProjects() {
  const [projects, setProjects] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const data = await api<{ projects: string[] }>("/api/conversations/projects");
      setProjects(data.projects);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { projects, reload, error };
}

export function useConversations(projectFilter: string) {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const data = await api<{ conversations: ConversationSummary[] }>(
        "/api/conversations",
        { query: { project: projectFilter || undefined } }
      );
      setItems(data.conversations);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    }
  }, [projectFilter]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, reload, error };
}

export function useConversationDetail(id: string | null) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      const data = await api<{ conversation: ConversationDetail }>(
        `/api/conversations/${id}`
      );
      setDetail(data.conversation);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
      setDetail(null);
    }
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { detail, reload, error };
}

export interface SendArgs {
  conversationId?: string;
  message: string;
  reasoningProfile: ReasoningProfile;
  toolsMode: ToolsMode;
  persona?: Persona;
  project?: string;
  /** Only consumed by the backend when the turn is routed to an image task. */
  imageQuality?: ImageQuality;
  imageSize?: ImageSize;
}

export interface SendResult {
  conversation: { id: string; title: string; project: string | null };
  taskKind: string;
  persona: Persona;
  toolsMode: ToolsMode;
  assistant: { id: string; text: string | null };
}

// ---------------------------------------------------------------------------
// Memory hooks
// ---------------------------------------------------------------------------

export function useProfile() {
  const [profile, setProfile] = useState<UserProfileRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const data = await api<{ profile: UserProfileRow }>("/api/profile");
      setProfile(data.profile);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { profile, reload, error };
}

export function useFacts(category?: string) {
  const [items, setItems] = useState<FactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const query: Record<string, string | undefined> = {};
      if (category) query.category = category;
      const data = await api<{ items: FactRow[]; total: number }>("/api/facts", { query });
      setItems(data.items);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
    }
  }, [category]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, total, reload, error };
}

export function useSendMessage() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (args: SendArgs): Promise<SendResult | null> => {
    setSending(true);
    setError(null);
    try {
      return await api<SendResult>("/api/chat", { method: "POST", body: args });
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code} (${err.status})`);
      else setError(String(err));
      return null;
    } finally {
      setSending(false);
    }
  }, []);

  return { send, sending, error };
}

export function useApproveOpenUrl() {
  const [pending, setPending] = useState<string | null>(null);
  const approve = useCallback(async (taskId: string) => {
    setPending(taskId);
    try {
      await api(`/api/tools/open_url/approve/${taskId}`, { method: "POST" });
    } finally {
      setPending(null);
    }
  }, []);
  return { approve, pending };
}
