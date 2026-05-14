import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { invokeAgent } from "@/src/foundryClient";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_NAME = process.env.COFOUNDER_AGENT_NAME ?? "CofounderAgent";

const PatchBody = z.object({
  title: z.string().min(1).max(120).optional(),
});

/**
 * PATCH /api/conversations/[id]/title
 *
 * If `title` is provided, update directly.
 * If omitted, auto-generate a title from the conversation messages
 * by asking the orchestrator persona to summarize in 5–10 words.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("conversation.title.PATCH", async () => {
    const { id } = await params;
    const conv = await prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 6 } },
    });
    if (!conv || conv.userId !== principal.userId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    let body;
    try {
      const raw = await req.text();
      body = PatchBody.parse(raw.trim() ? JSON.parse(raw) : {});
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "conversation.title.parse");
    }

    let newTitle = body.title;
    if (!newTitle) {
      const transcript = conv.messages
        .map((m) => `${m.sender}: ${m.text ?? ""}`)
        .join("\n");

      if (!transcript.trim()) {
        newTitle = conv.title;
      } else {
        const prompt =
          `Summarize this conversation in 5–10 words as a concise title. ` +
          `Respond with ONLY the title text, no quotes, no punctuation at the end.\n\n` +
          transcript.slice(0, 2000);

        try {
          const envelope = await invokeAgent(
            AGENT_NAME,
            {
              input: `[persona:orchestrator] [task:general_chat] ${prompt}`,
            },
            { timeoutMs: 10_000 }
          );
          const text =
            envelope.output
              ?.filter((o) => o.type === "message")
              .map((o: unknown) => {
                const msg = o as { content?: Array<{ text?: string }> };
                return msg.content?.map((c) => c.text).join(" ") ?? "";
              })
              .join(" ")
              .trim() ?? conv.title;
          newTitle = text.slice(0, 120).replace(/["'']/g, "");
        } catch (err) {
          console.error("[title-gen] failed:", err);
          newTitle = conv.title;
        }
      }
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { title: newTitle },
    });
    return NextResponse.json({ conversation: updated });
  });
}
