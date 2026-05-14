/**
 * /api/chat/finalize
 *
 * Counterpart to /api/chat for client-side LLM calls (Ollama, in
 * particular). The browser runs the model call directly against the
 * user's local Ollama (Pattern A: Ollama-first BYOK), then POSTs the
 * finalized turn here so we can:
 *
 *   - create or look up the Conversation row,
 *   - persist the user + assistant Message rows,
 *   - record token usage,
 *   - extract any [MEMORY_FACT:..] markers from the assistant text.
 *
 * This route does NOT call any model. It only persists what the
 * browser already produced. That keeps the user's prompts off our
 * server in the Ollama path (privacy win) and means we never need to
 * proxy to a model the server can't reach.
 *
 * For server-routed models (Foundry / direct OpenAI / Anthropic /
 * Gemini), use /api/chat — it handles the LLM call itself and persists
 * inline.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/src/prisma";
import {
  ownsConversation,
  requireAuth,
  requireSameOriginHeader,
} from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { createFact } from "@/src/memory";
import { extractAndStripFacts } from "@/src/server/factExtractor";
import { recordTokenUsage } from "@/src/server/tokenTracker";
import { redactSecrets } from "@/src/server/secretsPolicy";
import { logEvent } from "@/src/server/analytics";
import type { FactCategory } from "@/app/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MESSAGE_MAX_CHARS = 200_000;
// Assistant text from a local Ollama can be longer than user input
// (long generations, code blocks). Cap at 1MB to refuse runaway output.
const ASSISTANT_MAX_CHARS = 1_000_000;

const Body = z.object({
  conversationId: z.string().optional(),
  /** Raw user message (without persona/task routing prefixes). */
  userMessage: z.string().min(1).max(MESSAGE_MAX_CHARS),
  /** Final assistant text the local model produced. */
  assistantText: z.string().max(ASSISTANT_MAX_CHARS),
  /** Identifier of the model that produced the text (e.g. "ollama:llama3.2:3b"). */
  modelUsed: z.string().min(1).max(120),
  /** Provider tag for analytics — "ollama" | "openai-byok" | etc. */
  provider: z.string().min(1).max(60).default("ollama"),
  /** Optional usage numbers reported by the local model. */
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  /** Persona the UI was using for this turn (for the message row). */
  persona: z
    .enum(["orchestrator", "code_assistant", "brand_designer", "ops", "vision"])
    .optional(),
  /** Task label (free-form) for analytics; not enforced. */
  taskKind: z.string().max(40).optional(),
  /** Project label, like /api/chat. */
  project: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("chatFinalize.POST", async () => {
    let parsed;
    try {
      parsed = Body.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "chatFinalize.parse");
    }

    // Conversation: existing (owned) or new.
    let conv = parsed.conversationId
      ? await prisma.conversation.findUnique({
          where: { id: parsed.conversationId },
        })
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
          title: titleFromFirstMessage(parsed.userMessage),
          project: parsed.project ?? null,
        },
      });
    }

    // Persist user message FIRST so timeline order matches what the
    // model actually saw.
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        sender: "user",
        persona: parsed.persona ?? null,
        text: parsed.userMessage,
      },
    });

    // Extract memory facts + redact any secrets before persisting the
    // assistant text. The browser already saw the raw output; this is
    // for server-side storage only.
    const { cleaned, facts } = extractAndStripFacts(parsed.assistantText);
    const safeAssistantText = cleaned ? redactSecrets(cleaned) : null;

    const assistantMsg = await prisma.message.create({
      data: {
        conversationId: conv.id,
        sender: "assistant",
        persona: parsed.persona ?? null,
        text: safeAssistantText,
        taskKind: parsed.taskKind ?? null,
        modelUsed: parsed.modelUsed,
      },
    });

    await recordTokenUsage({
      userId: principal.userId,
      conversationId: conv.id,
      messageId: assistantMsg.id,
      modelUsed: parsed.modelUsed,
      promptTokens: parsed.promptTokens,
      completionTokens: parsed.completionTokens,
    });

    for (const f of facts) {
      try {
        await createFact({
          userId: principal.userId,
          category: f.category as FactCategory,
          label: f.label,
          fullText: f.fullText,
          importance: f.importance,
          source: `conversation:${conv.id}`,
        });
      } catch (err) {
        console.error("[chatFinalize.facts] failed:", err);
      }
    }

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: new Date() },
    });

    await logEvent(principal.userId, "chat_finalize_completed", {
      conversationId: conv.id,
      provider: parsed.provider,
      modelUsed: parsed.modelUsed,
      promptTokens: parsed.promptTokens,
      completionTokens: parsed.completionTokens,
      factsExtracted: facts.length,
    });

    return NextResponse.json({
      conversation: {
        id: conv.id,
        title: conv.title,
        project: conv.project,
      },
      assistant: {
        id: assistantMsg.id,
        text: safeAssistantText,
        modelUsed: parsed.modelUsed,
        createdAt: assistantMsg.createdAt.toISOString(),
      },
      factsExtracted: facts.length,
    });
  });
}

function titleFromFirstMessage(msg: string): string {
  const trimmed = msg.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 60) return trimmed;
  return trimmed.slice(0, 57) + "...";
}
