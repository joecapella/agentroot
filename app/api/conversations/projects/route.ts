/**
 * GET /api/conversations/projects
 *
 * Returns the distinct list of `project` tags across ALL of the caller's
 * conversations — not just the latest 100 returned by /api/conversations.
 *
 * Bug-4 fix: the sidebar previously derived its project filter from the
 * `conversations` list, which is capped at the 100 most-recently-active. As
 * a result, older projects silently disappeared from the filter dropdown.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/prisma";
import { requireAuth } from "@/src/server/auth";
import { runRoute } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("conversations.projects.GET", async () => {
    const rows = await prisma.conversation.findMany({
      where: { userId: principal.userId, project: { not: null } },
      select: { project: true },
      distinct: ["project"],
      orderBy: { project: "asc" },
    });
    const projects = rows
      .map((r) => r.project)
      .filter((p): p is string => typeof p === "string");
    return NextResponse.json({ projects });
  });
}
