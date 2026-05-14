import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/src/prisma";
import {
  extractUsage,
  flattenEnvelope,
  generateImages,
  isValidResponseId,
  type InvokeError,
} from "@/src/foundryClient";
import { invokeLLM } from "@/src/server/llmRouter";
import {
  inferTaskKind,
  personaForTask,
  pickByokChatModel,
  pickChatModelForTask,
  type DeploymentSpec,
  type Persona,
  type TaskKind,
  type UserKeys,
} from "@/src/modelRouting";
import {
  ownsConversation,
  requireAuth,
  requireSameOriginHeader,
} from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { getMemoryPreamble, createFact } from "@/src/memory";
import { extractAndStripFacts } from "@/src/server/factExtractor";
import { runReActLoop, type LoopEvent } from "@/src/server/agentLoop";
import { recordTokenUsage } from "@/src/server/tokenTracker";
import { logEvent } from "@/src/server/analytics";
import { composeInstructions } from "@/src/server/personaPrompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/**
 * Max chars on a single chat input. Bumped 2026-05-14 from 20k → 200k so
 * "paste this stack trace / file / failing test output" workflows work.
 * The real ceiling is whichever model's context window is in play; the LLM
 * router and `truncateHistory` enforce that downstream.
 */
const MESSAGE_MAX_CHARS = 200_000;

const IMAGE_QUALITY_VALUES = ["auto", "low", "medium", "high"] as const;
const IMAGE_SIZE_VALUES = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
] as const;

/**
 * Per-request BYOK ("Bring Your Own Key") schema.
 *
 * Keys arrive in-memory for the duration of one request and are never
 * persisted to the database, written to disk, logged in plaintext, or
 * echoed back to the client. The `secretsPolicy` redactor catches any
 * accidental echo by the model.
 *
 * Each field is bounded to 256 chars to refuse oversized junk early.
 * The provider APIs themselves validate the prefix and signature.
 */
const UserKeysSchema = z
  .object({
    openai: z.string().max(256).optional(),
    anthropic: z.string().max(256).optional(),
    gemini: z.string().max(256).optional(),
  })
  .optional();

const Body = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(MESSAGE_MAX_CHARS),
  reasoningProfile: z.enum(["fast", "balanced", "deep"]).default("balanced"),
  toolsMode: z.enum(["off", "ask", "allowed"]).default("ask"),
  persona: z
    .enum(["orchestrator", "code_assistant", "brand_designer", "ops", "vision"])
    .optional(),
  project: z.string().max(80).optional(),
  imageQuality: z.enum(IMAGE_QUALITY_VALUES).optional(),
  imageSize: z.enum(IMAGE_SIZE_VALUES).optional(),
  imageBase64: z.string().optional(),
  userKeys: UserKeysSchema,
});

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const AGENT_NAME = process.env.COFOUNDER_AGENT_NAME ?? "CofounderAgent";

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return runRoute("chat.POST", async () =>
      sanitizedError("bad_request", 400, err, "chat.parse")
    );
  }

  const {
    message,
    reasoningProfile,
    toolsMode,
    persona,
    project,
    imageQuality,
    imageSize,
  } = parsed;

  let conv: Awaited<ReturnType<typeof prisma.conversation.findUnique>>;
  let taskKind: TaskKind;
  let effectivePersona: Persona;
  let route: DeploymentSpec;
  let memoryPreamble: string | null;
  try {
    conv = parsed.conversationId
      ? await prisma.conversation.findUnique({ where: { id: parsed.conversationId } })
      : null;

    if (parsed.conversationId && !conv) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (conv && !ownsConversation(principal, conv)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!conv) {
      conv = await prisma.conversation.create({
        data: {
          userId: principal.userId,
          title: titleFromFirstMessage(message),
          project: project ?? null,
        },
      });
    }

    taskKind = inferTaskKind(message, { reasoning: reasoningProfile, persona });
    effectivePersona = persona ?? personaForTask(taskKind);
    // BYOK routing: if the request carries a user-supplied provider key,
    // route directly to that provider with the user's key. Otherwise
    // fall back to the default Foundry-hosted path. Keys live in the
    // browser's localStorage and are sent per-request; the server NEVER
    // persists them.
    const byok = pickByokChatModel(parsed.userKeys ?? null, taskKind);
    route = byok ?? pickChatModelForTask(taskKind);
    // Hot-loaded persona prompt + memory preamble.
    //
    // We deliberately do NOT send these as the Responses-protocol
    // `instructions` field — Foundry hosted agents reject that with HTTP
    // 400 `invalid_payload` / `param: instructions` (same forbidden-list
    // behaviour as top-level `tools`). Instead, the downstream paths
    // inject this content as a `[SYSTEM_OVERRIDE]` prefix inside the
    // first user message of the conversation. Subsequent turns inherit
    // context via `previous_response_id` and skip the prefix.
    const factsPreamble = await getMemoryPreamble(principal.userId);
    memoryPreamble = composeInstructions(effectivePersona, factsPreamble) ?? null;

    // Store user message — persist the raw user text (without the
    // [persona:..] / [task:..] routing prefixes), so message history and
    // replay don't leak routing internals into the UI (Bug-9 fix). The
    // prefixes are still added back to `userContent` later when we ship
    // the turn to the model.
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        sender: "user",
        persona: persona ?? null,
        text: message,
      },
    });
  } catch (err) {
    console.error("[chat] pre-stream error:", err);
    return sanitizedError("internal_error", 500, err, "chat.preStream");
  }

  // Stream response
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(new TextEncoder().encode(sse(event, data)));
      };

      try {
        // Build multimodal input
        let userContent = `[persona:${effectivePersona}] [task:${taskKind}] ${message}`;
        if (parsed.imageBase64) {
          userContent = `[persona:${effectivePersona}] [task:${taskKind}] ${message}`;
        }

        // If toolsMode is "off", this is a simple chat, or this is an explicit
        // visual-generation request, use the single-turn path. Visual requests
        // are handled by the backend's direct Azure OpenAI image call below;
        // letting the ReAct loop decide whether to call generate_image made
        // image generation flaky/invisible to the UI.
        if (toolsMode === "off" || taskKind === "fast_brainstorm" || taskKind === "visual") {
          await handleSingleTurn({
            conv,
            userContent,
            imageBase64: parsed.imageBase64,
            imageQuality: imageQuality ?? "auto",
            imageSize: imageSize ?? "auto",
            memoryPreamble,
            taskKind,
            effectivePersona,
            route,
            send,
            userId: principal.userId,
            userKeys: parsed.userKeys ?? undefined,
          });
          // NOTE: do NOT close the controller here. The outer `finally`
          // block at the bottom of this stream calls controller.close()
          // exactly once. Closing here + falling through to finally
          // throws ERR_INVALID_STATE ("Controller is already closed"),
          // which propagates as a piped-response failure and surfaces
          // in the browser as a generic `TypeError: network error`
          // mid-stream — observed for every single-turn / visual
          // request before this fix.
          return;
        }

        // ReAct loop
        const result = await runReActLoop({
          userId: principal.userId,
          conversationId: conv.id,
          agentName: AGENT_NAME,
          route,
          toolsMode,
          repoRoot: process.env.REPO_ROOT ?? process.cwd(),
          imageQuality: imageQuality ?? "auto",
          imageSize: imageSize ?? "auto",
          memoryPreamble: memoryPreamble ?? undefined,
          // BYOK per-request keys. Forwarded to invokeLLM and
          // generateImages inside the loop; never persisted.
          userKeys: parsed.userKeys ?? undefined,
          onEvent: async (event: LoopEvent) => {
            send(event.type, event.data);
          },
          signal: req.signal,
        });

        // Final update
        await prisma.conversation.update({
          where: { id: conv.id },
          data: { lastMessageAt: new Date() },
        });

        send("done", {
          conversation: { id: conv.id, title: conv.title, project: conv.project },
          taskKind,
          persona: effectivePersona,
          toolsMode,
          loopCount: result.loopCount,
          approvalsCreated: result.approvalsCreated,
        });
      } catch (err) {
        console.error("[chat] stream error:", err);
        try {
          send("error", { code: "internal_error", message: String(err) });
        } catch {
          // controller may already be closed; nothing to do
        }
      } finally {
        // Idempotent close. ReadableStream's default controller throws
        // ERR_INVALID_STATE on double-close, which would surface as a
        // pipe failure (browser sees `TypeError: network error`).
        try {
          controller.close();
        } catch {
          // already closed — fine
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function handleSingleTurn(args: {
  conv: { id: string; title: string; project: string | null; previousResponseId: string | null };
  userContent: string;
  imageBase64?: string;
  imageQuality?: "auto" | "low" | "medium" | "high";
  imageSize?: "auto" | "1024x1024" | "1024x1536" | "1536x1024";
  memoryPreamble?: string | null;
  taskKind: string;
  effectivePersona: Persona;
  route: DeploymentSpec;
  send: (event: string, data: unknown) => void;
  userId: string;
  /** Per-request BYOK keys. In-memory only; never persisted or logged. */
  userKeys?: UserKeys;
}) {
  const { conv, userContent, imageBase64, imageQuality, imageSize, memoryPreamble, taskKind, effectivePersona, route, send, userId, userKeys } = args;

  send("status", { status: "thinking" });

  // Inject the persona prompt + memory preamble as a SYSTEM_OVERRIDE
  // block inside the user message when EITHER:
  //   - it's the first turn of a conversation (no previousResponseId), OR
  //   - this is an explicit visual task — the deployed container's baked
  //     prompt currently tells the model image generation isn't wired,
  //     so we must re-assert capability on every visual turn until the
  //     container is rebaked + redeployed.
  // Re-injecting on every turn would bloat context for normal chat, so
  // we keep it scoped.
  const shouldInjectOverride =
    !!memoryPreamble && (!conv.previousResponseId || taskKind === "visual");
  const decoratedUserText = shouldInjectOverride
    ? `[SYSTEM_OVERRIDE]\n${memoryPreamble}\n[/SYSTEM_OVERRIDE]\n\n${userContent}`
    : userContent;

  let inputForAgent: import("@/src/server/llmRouter").LLMPayload["input"];
  if (imageBase64) {
    inputForAgent = [
      {
        role: "user",
        content: [
          { type: "input_text", text: decoratedUserText },
          { type: "input_image", image_url: { url: imageBase64 } },
        ],
      },
    ];
  } else {
    inputForAgent = decoratedUserText;
  }

  // For explicit visual generation we skip the chat model entirely.
  // The chat model's text on a visual turn is wasted tokens — we
  // either discard it (image succeeds) or replace it with the concrete
  // image error (image fails). Skipping the invoke also avoids the
  // current container's stale "I can't generate images" refusal
  // bleeding into the SSE stream before the image arrives.
  let envelope: import("@/src/foundryClient").ResponsesEnvelope;
  if (taskKind === "visual") {
    envelope = {
      id: "local_visual_skip",
      object: "response",
      status: "completed",
      error: null,
      output: [],
    };
  } else {
  try {
    envelope = await invokeLLM(
      route,
      AGENT_NAME,
      {
        input: inputForAgent,
        previous_response_id: conv.previousResponseId ?? undefined,
        // NOTE: `instructions` is rejected by Foundry hosted agents
        // (`invalid_payload` / `param: instructions`). The override is
        // injected inside the user text above instead.
      },
      { userKeys },
    );
  } catch (err) {
    const e = err as InvokeError;
    console.error("[chat.singleTurn] foundry invoke failed:", {
      status: e.status,
      message: e.message,
      requestId: e.requestId,
      body: e.body,
    });
    send("error", {
      code: "foundry_invoke_failed",
      status: e.status,
      message: e.message,
      detail:
        typeof e.body === "object" && e.body !== null
          ? (e.body as { error?: { message?: string; code?: string } }).error
          : undefined,
    });
    return;
  }

  if (envelope.status === "failed" || envelope.error) {
    send("error", { code: "agent_failed", envelopeError: envelope.error, status: envelope.status });
    return;
  }
  } // end of non-visual invokeLLM branch

  const flat = flattenEnvelope(envelope);

  // Handle explicit visual task image generation. This is intentionally
  // backend-driven instead of relying on the hosted agent to emit a
  // generate_image tool call: image generation is the user's primary request,
  // not an optional model decision.
  let extraImages: string[] = [];
  let imageWarning: string | null = null;
  if (taskKind === "visual") {
    const imagePrompt = userContent.replace(/^\[persona:[^\]]+\]\s*\[task:[^\]]+\]\s*/, "");
    send("status", { status: "generating_images", total: 1 });
    try {
      const gen = await generateImages({
        prompt: imagePrompt,
        n: 1,
        quality: imageQuality ?? "auto",
        size: imageSize ?? "auto",
        // BYOK: if user pasted an OpenAI key, route image-gen to public
        // OpenAI's gpt-image-1 with that key. Otherwise Azure managed-ID
        // path (Joseph's self-hosted setup).
        byokOpenAIKey: userKeys?.openai,
      });
      extraImages = gen.images;
      for (let i = 0; i < extraImages.length; i++) {
        send("image_progress", { current: i + 1, total: extraImages.length });
      }
      if (extraImages.length === 0) {
        imageWarning = gen.errors[0] ?? "No image was returned by the image deployment.";
        send("status", { status: "image_generation_failed", message: imageWarning });
      }
    } catch (genErr) {
      imageWarning = genErr instanceof Error ? genErr.message : String(genErr);
      console.error("[image-gen] failed:", genErr);
      send("status", { status: "image_generation_failed", message: imageWarning });
    }
  }

  // Combine images
  const allImages: string[] = [];
  if (flat.imageBase64) {
    const approxBytes = Math.ceil((flat.imageBase64.length * 3) / 4);
    if (approxBytes <= IMAGE_MAX_BYTES) allImages.push(flat.imageBase64);
  }
  for (const img of extraImages) {
    const approxBytes = Math.ceil((img.length * 3) / 4);
    if (approxBytes <= IMAGE_MAX_BYTES) allImages.push(img);
  }

  let imageBase64ToSave: string | null = null;
  if (allImages.length === 1) imageBase64ToSave = allImages[0];
  else if (allImages.length > 1) imageBase64ToSave = JSON.stringify(allImages);

  // For explicit visual tasks the backend drives generation directly via
  // gpt-image-2-1, NOT the chat model. The chat model's text on a visual
  // turn is at best a brief; at worst it tells Joseph that image
  // generation isn't wired (the deployed container's baked prompt still
  // claims that, until rebaked). Either way it is more confusing than
  // helpful when there's already an image in the result. So:
  //   - image succeeded → drop the model's text, let the image speak.
  //   - image failed → return a concrete one-line error, NOT the
  //     model's prose. The error is what Joseph needs to act on.
  //   - non-visual tasks → behave as before.
  let rawAssistantText: string;
  if (taskKind === "visual") {
    if (imageWarning) {
      rawAssistantText = `Image generation failed: ${imageWarning}`;
    } else if (allImages.length > 0) {
      rawAssistantText = "";
    } else {
      rawAssistantText = flat.text;
    }
  } else {
    rawAssistantText = imageWarning
      ? [flat.text, `Image generation failed: ${imageWarning}`].filter(Boolean).join("\n\n")
      : flat.text;
  }

  const { cleaned: cleanedText, facts } = rawAssistantText
    ? extractAndStripFacts(rawAssistantText)
    : { cleaned: rawAssistantText || "", facts: [] };

  // Defensive secret redaction on assistant text. We already redact tool
  // output before the model sees it, but the model itself can echo a
  // secret back into prose in the same turn — strip before DB write.
  const { redactSecrets } = await import("@/src/server/secretsPolicy");
  const safeAssistantText = cleanedText ? redactSecrets(cleanedText) : null;

  const assistantMsg = await prisma.message.create({
    data: {
      conversationId: conv.id,
      sender: "assistant",
      persona: effectivePersona,
      text: safeAssistantText,
      imageBase64: imageBase64ToSave,
      taskKind,
      modelUsed: route.deployment,
    },
  });

  // Real usage from the envelope (Bug-3 fix). Falls back to 0/0 when the
  // upstream omits `usage`; no character-count heuristics.
  const { promptTokens, completionTokens } = extractUsage(envelope);
  await recordTokenUsage({
    userId,
    conversationId: conv.id,
    messageId: assistantMsg.id,
    modelUsed: route.deployment,
    promptTokens,
    completionTokens,
  });

  // Persist envelope.id so the next turn can chain via previous_response_id
  // (Bug-2 fix). We only persist ids that match the Responses shape.
  if (isValidResponseId(envelope.id)) {
    try {
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { previousResponseId: envelope.id },
      });
    } catch (err) {
      console.warn("[chat.singleTurn] previousResponseId persist failed:", err);
    }
  }

  await logEvent(userId, "chat_turn_completed", {
    conversationId: conv.id,
    taskKind,
    persona: effectivePersona,
    modelUsed: route.deployment,
    factsExtracted: facts.length,
  });

  for (const f of facts) {
    try {
      await createFact({
        userId,
        category: f.category as import("@/app/lib/types").FactCategory,
        label: f.label,
        fullText: f.fullText,
        importance: f.importance,
        source: `conversation:${conv.id}`,
      });
    } catch (err) {
      console.error("[fact-extract] failed:", err);
    }
  }

  await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date() },
  });

  send("message", {
    id: assistantMsg.id,
    sender: "assistant",
    persona: effectivePersona,
    text: safeAssistantText,
    imageBase64: imageBase64ToSave,
    taskKind,
    modelUsed: route.deployment,
    createdAt: assistantMsg.createdAt.toISOString(),
  });

  send("done", {
    conversation: { id: conv.id, title: conv.title, project: conv.project },
    taskKind,
    persona: effectivePersona,
    toolsMode: "off",
    assistant: assistantMsg,
    factsExtracted: facts.length,
  });
}

// Fact extraction moved to `src/server/factExtractor.ts` so both the
// single-turn path and the ReAct loop share one implementation. Imported
// at the top of this file.

function titleFromFirstMessage(msg: string): string {
  const trimmed = msg.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 60) return trimmed;
  return trimmed.slice(0, 57) + "...";
}
