import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { createTtsJob, getVoiceJob } from "@/src/server/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostBody = z.object({
  text: z.string().min(1).max(4000),
  voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).optional(),
});

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("voice.POST", async () => {
    let body;
    try {
      body = PostBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "voice.parse");
    }

    const job = await createTtsJob({
      userId: principal.userId,
      text: body.text,
      voice: body.voice,
    });

    return NextResponse.json(job, { status: 202 });
  });
}

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("voice.GET", async () => {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "missing_jobId" }, { status: 400 });
    }

    const job = await getVoiceJob(jobId, principal.userId);
    if (!job) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ job });
  });
}
