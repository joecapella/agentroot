/**
 * GET|PUT /api/tool-policies — per-user per-tool policy management.
 *
 * The server enumerates all known tools and merges with the user's
 * prisma.toolPolicy rows. A missing row means "ask" (the default).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLICY_VALUES = ["ask", "allowed", "blocked", "readonly"] as const;

/** Canonical list of all tools the agent can call, with metadata. */
const KNOWN_TOOLS: Array<{
  toolName: string;
  category: string;
  description: string;
}> = [
  { toolName: "read_file", category: "Filesystem", description: "Read a text file by path" },
  { toolName: "list_directory", category: "Filesystem", description: "List files and directories" },
  { toolName: "write_file", category: "Filesystem", description: "Write content to a file (destructive)" },
  { toolName: "search_replace", category: "Filesystem", description: "Replace text in a file (destructive)" },
  { toolName: "run_command", category: "Shell", description: "Run a shell command (destructive)" },
  { toolName: "fetch_url", category: "Web", description: "Fetch a URL and return cleaned text" },
  { toolName: "open_url", category: "Web", description: "Open a URL in the browser" },
  { toolName: "grep", category: "Search", description: "Search code for a pattern" },
  { toolName: "find_files", category: "Search", description: "Find files by glob pattern" },
  { toolName: "git_status", category: "Git", description: "Get git status" },
  { toolName: "git_diff", category: "Git", description: "Get git diff against target" },
  { toolName: "git_log", category: "Git", description: "Get git log" },
  { toolName: "git_branch", category: "Git", description: "List git branches" },
  { toolName: "git_show", category: "Git", description: "Show a git object" },
  { toolName: "calendar_create", category: "Calendar", description: "Create a calendar event draft" },
  { toolName: "calendar_list", category: "Calendar", description: "List upcoming calendar events" },
  { toolName: "http_request", category: "HTTP", description: "Send an HTTP request to any API" },
  { toolName: "create_todo", category: "Task", description: "Create a task / todo item" },
  { toolName: "generate_image", category: "Image", description: "Generate an image via AI" },
];

const PutBody = z.object({
  policies: z.array(
    z.object({
      toolName: z.string().min(1),
      policy: z.enum(POLICY_VALUES),
    })
  ),
});

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("toolPolicies.GET", async () => {
    const dbPolicies = await prisma.toolPolicy.findMany({
      where: { userId: principal.userId },
    });
    const dbMap = new Map(dbPolicies.map((p) => [p.toolName, p.policy]));

    const policies = KNOWN_TOOLS.map((t) => ({
      ...t,
      policy: (dbMap.get(t.toolName) as (typeof POLICY_VALUES)[number]) ?? "ask",
    }));

    return NextResponse.json({ policies });
  });
}

export async function PUT(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("toolPolicies.PUT", async () => {
    let body;
    try {
      body = PutBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "toolPolicies.parse");
    }

    const validToolNames = new Set(KNOWN_TOOLS.map((t) => t.toolName));
    for (const p of body.policies) {
      if (!validToolNames.has(p.toolName)) {
        return sanitizedError("bad_request", 400, `Unknown tool: ${p.toolName}`, "toolPolicies.validate");
      }
    }

    // Batch upsert using transaction
    await prisma.$transaction(
      body.policies.map((p) =>
        prisma.toolPolicy.upsert({
          where: { userId_toolName: { userId: principal.userId, toolName: p.toolName } },
          create: { userId: principal.userId, toolName: p.toolName, policy: p.policy },
          update: { policy: p.policy },
        })
      )
    );

    return NextResponse.json({ saved: body.policies.length });
  });
}
