import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { triggerGitHubWorkflow, listCiCdJobs } from "@/src/server/cicd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostBody = z.object({
  repo: z.string().min(1),
  workflow: z.string().min(1),
  branch: z.string().optional(),
  inputs: z.record(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("cicd.POST", async () => {
    let body;
    try {
      body = PostBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "cicd.parse");
    }

    const job = await triggerGitHubWorkflow({
      userId: principal.userId,
      repo: body.repo,
      workflow: body.workflow,
      branch: body.branch,
      inputs: body.inputs,
    });

    return NextResponse.json(job, { status: 202 });
  });
}

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("cicd.GET", async () => {
    const jobs = await listCiCdJobs(principal.userId);
    return NextResponse.json({ jobs });
  });
}
