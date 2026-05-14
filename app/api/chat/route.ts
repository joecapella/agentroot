import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/src/prisma";
import {
  flattenEnvelope,
  generateImages,
  invokeAgent,
  isValidResponseId,
  type InvokeError,
} from "@/src/foundryClient";
import {
  inferTaskKind,
  personaForTask,
  pickChatModelForTask,
  type Persona,
} from "@/src/modelRouting";
import {
  ownsConversation,
  requireAuth,
  requireSameOriginHeader,
} from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { getMemoryPreamble } from "@/src/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/chat — authenticated, single-user.
 *
 * The Principal's userId is the ONLY source of ownership. We do not accept
 * userId from the request body. We do accept conversationId, but we verify
 * that the conversation belongs to the principal before appending to it.
 *
 * Image base64 outputs from the agent are capped at IMAGE_MAX_BYTES before
 * being written to the DB. Anything larger returns 413 with a stable code
 * and the caller is expected to retry with a smaller image (or, later, a
 * blob-storage backed path).
 *
 * gpt-image-2 high-quality landscape (1536x1024) PNG outputs routinely exceed
 * 2 MB, so the cap is raised to 10 MB. This is the same order of magnitude
 * SQLite can hold in a single BLOB without paging pain. If we ever need
 * bigger, switch to blob-storage-backed rendering instead of raising further.
 */

const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB (was 2 MB)
const MESSAGE_MAX_CHARS = 20_000;

/** Validated subset of gpt-image-2 capabilities. See app/lib/types.ts for
 *  rationale on why custom sizes are not exposed in v1. */
const IMAGE_QUALITY_VALUES = ["auto", "low", "medium", "high"] as const;
const IMAGE_SIZE_VALUES = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
] as const;

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
});

/**
 * Decide whether this turn should attach the hosted `image_generation` tool.
 *
 * We attach it when the routing layer thinks this is a visual task, OR when
 * the user explicitly picked the brand_designer / vision persona. We do NOT
 * attach it on every turn because (a) it costs more, (b) it can confuse the
 * model into generating unwanted images.
 */
function wantsImageTool(args: {
  taskKind: string;
  persona: Persona;
}): boolean {
  return (
    args.taskKind === "visual" ||
    args.persona === "brand_designer" ||
    args.persona === "vision"
  );
}

const AGENT_NAME = process.env.COFOUNDER_AGENT_NAME ?? "CofounderAgent";

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("chat.POST", async () => {
    let parsed;
    try {
      parsed = Body.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "chat.parse");
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

    // 1. Load or create the conversation — owned by the authenticated user.
    let conv = parsed.conversationId
      ? await prisma.conversation.findUnique({ where: { id: parsed.conversationId } })
      : null;

    if (parsed.conversationId && !conv) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (conv && !ownsConversation(principal, conv)) {
      // 404 (not 403) to avoid leaking the existence of other-user ids.
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

    // 2. Routing decisions.
    //    `route` is the deployment that will actually produce CHAT text for
    //    this turn. For `visual`/`vision` tasks we still need a chat model
    //    (the visual output is produced by a hosted *tool*, not by replacing
    //    the chat client). `pickChatModelForTask` walks fallbacks until it
    //    finds one with `family: "azure_openai"`.
    const taskKind = inferTaskKind(message, { reasoning: reasoningProfile, persona });
    const effectivePersona: Persona = persona ?? personaForTask(taskKind);
    const route = pickChatModelForTask(taskKind);

    // 2b. Build the hosted-tools array. Only attach `image_generation` when
    //     the turn looks visual; this avoids spurious image generation on
    //     plain chat turns and keeps costs predictable.
    const attachImageTool =
      toolsMode === "allowed" &&
      wantsImageTool({
        taskKind,
        persona: effectivePersona,
      });
    const tools = attachImageTool
      ? [
          {
            type: "image_generation",
            // Defaults match the gpt-image-2 docs: `auto` for both.
            quality: imageQuality ?? "auto",
            size: imageSize ?? "auto",
          },
        ]
      : undefined;

    // 3. Memory preamble: silently inject persistent facts/knowledge into the
    //    agent's context. This is the core of the "AI wingman" experience:
    //    the agent remembers who you are, what you care about, and what you
    //    have forbidden. We cap the budget so we do not starve the actual
    //    conversation of token space.
    const memoryPreamble = await getMemoryPreamble(principal.userId);

    // 4. Invoke the hosted agent FIRST. We deliberately do not write any
    //    rows yet — if the call fails or the envelope is unusable we must
    //    not leave an orphan user message with an advanced session pointer.
    const userMessageOptions =
      attachImageTool && (imageQuality || imageSize)
        ? JSON.stringify({
            imageQuality: imageQuality ?? "auto",
            imageSize: imageSize ?? "auto",
          })
        : null;
    const inputForAgent = `[persona:${effectivePersona}] [task:${taskKind}] ${message}`;

    let envelope;
    try {
      envelope = await invokeAgent(AGENT_NAME, {
        input: inputForAgent,
        previous_response_id: conv.foundrySession ?? undefined,
        ...(memoryPreamble ? { instructions: memoryPreamble } : {}),
        // Forward hosted tools when applicable. The Responses-protocol
        // request shape allows arbitrary additional fields; unknown fields
        // are ignored by older container versions, so this is
        // forward-compatible.
        ...(tools ? { tools } : {}),
      });
    } catch (err) {
      const e = err as InvokeError;
      // Transport-level failure: NOTHING has been persisted for this turn.
      // The user can retry without any DB cleanup. We still log full detail
      // server-side via sanitizedError.
      return sanitizedError(
        "foundry_invoke_failed",
        502,
        { status: e.status, requestId: e.requestId, body: e.body, message: e.message },
        "chat.invoke"
      );
    }

    // 5. Envelope-level "logical" failure (HTTP 200 but status=failed).
    //    Persist the user message + a system note in ONE transaction so the
    //    UI shows what happened, but do NOT advance foundrySession — a
    //    failed-response id is not a valid chain target.
    if (envelope.status === "failed" || envelope.error) {
      const failTx = await prisma.$transaction(async (tx) => {
        await tx.message.create({
          data: {
            conversationId: conv.id,
            sender: "user",
            persona: persona ?? null,
            text: message,
            toolCallsJson: userMessageOptions,
          },
        });
        const sysMsg = await tx.message.create({
          data: {
            conversationId: conv.id,
            sender: "system",
            text: "Agent reported an error. See server logs (requestId in response) for detail.",
            taskKind,
            modelUsed: route.deployment,
          },
        });
        await tx.conversation.update({
          where: { id: conv.id },
          // Intentionally do NOT update foundrySession; previous chain stays valid.
          data: { lastMessageAt: new Date() },
        });
        return sysMsg;
      });
      const failResp = sanitizedError(
        "agent_failed",
        502,
        { envelopeError: envelope.error, status: envelope.status },
        "chat.envelopeFailed"
      );
      const failBody = await failResp.json();
      return NextResponse.json(
        {
          ...failBody,
          conversation: { id: conv.id, title: conv.title, project: conv.project },
          assistant: failTx,
        },
        { status: 502 }
      );
    }

    // 6. Flatten the envelope.
    const flat = flattenEnvelope(envelope);

    // 6b. For visual tasks, generate images directly via the Azure OpenAI
    //     image endpoint. The hosted agent container cannot reach external
    //     APIs, so the Node backend generates images and stitches them into
    //     the assistant response.
    let extraImages: string[] = [];
    let droppedGeneratedImages = 0;
    if (taskKind === "visual") {
      try {
        const gen = await generateImages({
          prompt: message,
          n: 3,
          quality: imageQuality ?? "auto",
          size: imageSize ?? "auto",
        });
        extraImages = gen.images;
        droppedGeneratedImages = gen.droppedCount;
      } catch (genErr) {
        // Image generation failure is non-fatal; we still return the
        // Foundry text response. Log for debugging.
        console.error("[image-gen] failed:", genErr);
      }
    }

    // 6c. Decide whether to keep images (hosted tool results + generated).
    //    BEHAVIOUR CHANGE (was Bug-2): if only the image exceeds the size
    //    cap we drop the image and STILL persist the assistant text plus a
    //    small system note. Returning 413 and silently discarding everything
    //    advanced conversation state but left the user with no answer.
    const allImages: string[] = [];
    let droppedHostedImage = 0;
    if (flat.imageBase64) {
      const approxBytes = Math.ceil((flat.imageBase64.length * 3) / 4);
      if (approxBytes <= IMAGE_MAX_BYTES) allImages.push(flat.imageBase64);
      else droppedHostedImage++;
    }
    for (const img of extraImages) {
      const approxBytes = Math.ceil((img.length * 3) / 4);
      if (approxBytes <= IMAGE_MAX_BYTES) allImages.push(img);
      else droppedGeneratedImages++;
    }

    let imageBase64ToSave: string | null = null;
    if (allImages.length === 1) {
      imageBase64ToSave = allImages[0];
    } else if (allImages.length > 1) {
      // Store as JSON array for multi-image assistant messages.
      imageBase64ToSave = JSON.stringify(allImages);
    }

    const droppedImage = droppedHostedImage > 0 || droppedGeneratedImages > 0;

    // 7. Decide the next previous_response_id (Bug-5). Only accept envelope
    //    ids whose shape matches the Responses-protocol pattern. Anything
    //    else (e.g. a Foundry agent_session_id) keeps the previous valid
    //    chain target rather than poisoning the next turn.
    const nextPreviousResponseId = isValidResponseId(envelope.id)
      ? envelope.id
      : conv.foundrySession ?? null;

    const toolCallsJson =
      flat.toolCalls.length > 0 ? JSON.stringify(flat.toolCalls) : null;

    // 8. Commit the whole turn atomically: user message, assistant message,
    //    optional drop-image system note, conversation update, and task
    //    rows. SQLite supports nested $transaction.
    const { assistantMsg } = await prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          conversationId: conv.id,
          sender: "user",
          persona: persona ?? null,
          text: message,
          // Reuse toolCallsJson as the user-intent options channel — Zod
          // already validated the enum values, so this is non-XSS safe.
          toolCallsJson: userMessageOptions,
        },
      });

      const am = await tx.message.create({
        data: {
          conversationId: conv.id,
          sender: "assistant",
          persona: effectivePersona,
          // Always keep text if present, even when we had to drop an oversized
          // image. Older callers may have relied on text-only output.
          text: flat.text || null,
          imageBase64: imageBase64ToSave,
          toolCallsJson,
          taskKind,
          modelUsed: route.deployment,
        },
      });

      if (droppedImage) {
        await tx.message.create({
          data: {
            conversationId: conv.id,
            sender: "system",
            text:
              `Agent returned an image larger than the ${IMAGE_MAX_BYTES} byte cap; ` +
              `image was dropped (text was kept).`,
            taskKind,
            modelUsed: route.deployment,
          },
        });
      }

      await tx.conversation.update({
        where: { id: conv.id },
        data: {
          foundrySession: nextPreviousResponseId,
          lastMessageAt: new Date(),
        },
      });

      for (const call of flat.toolCalls) {
        await tx.task.create({
          data: {
            userId: principal.userId,
            conversationId: conv.id,
            messageId: am.id,
            type: call.name,
            status: call.status === "completed" ? "COMPLETED" : "IN_PROGRESS",
            paramsJson: call.arguments,
            summary: `${call.name}(...)`,
          },
        });
      }

      return { assistantMsg: am };
    });

    return NextResponse.json({
      conversation: { id: conv.id, title: conv.title, project: conv.project },
      taskKind,
      persona: effectivePersona,
      toolsMode,
      droppedImage: droppedImage || undefined,
      assistant: assistantMsg,
    });
  });
}

function titleFromFirstMessage(msg: string): string {
  const trimmed = msg.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 60) return trimmed;
  return trimmed.slice(0, 57) + "...";
}
