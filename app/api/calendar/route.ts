import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { createCalendarDraft, listCalendarEvents } from "@/src/server/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  timezone: z.string().max(50).optional(),
});

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("calendar.POST", async () => {
    let body;
    try {
      body = PostBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "calendar.parse");
    }

    const event = await createCalendarDraft({
      userId: principal.userId,
      title: body.title,
      description: body.description,
      startAt: new Date(body.startAt),
      endAt: body.endAt ? new Date(body.endAt) : undefined,
      timezone: body.timezone,
    });

    return NextResponse.json({ event });
  });
}

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("calendar.GET", async () => {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);
    const events = await listCalendarEvents(principal.userId, limit);
    return NextResponse.json({ events });
  });
}
