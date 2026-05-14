/**
 * CI/CD pipeline trigger tool (GitHub Actions).
 *
 * Dispatches workflow runs via the GitHub API.
 */

import { prisma } from "@/src/prisma";

export async function triggerGitHubWorkflow(args: {
  userId: string;
  repo: string; // "owner/repo"
  workflow: string; // workflow filename, e.g. "deploy.yml"
  branch?: string;
  inputs?: Record<string, string>;
}): Promise<{ jobId: string; status: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN not configured");
  }

  const job = await prisma.ciCdJob.create({
    data: {
      userId: args.userId,
      provider: "github",
      repo: args.repo,
      workflow: args.workflow,
      branch: args.branch ?? "main",
      status: "pending",
    },
  });

  // Fire-and-forget dispatch
  dispatchWorkflow(job.id, token, args).catch((err) => {
    console.error("[cicd] dispatch failed:", err);
  });

  return { jobId: job.id, status: "pending" };
}

async function dispatchWorkflow(
  jobId: string,
  token: string,
  args: {
    repo: string;
    workflow: string;
    branch?: string;
    inputs?: Record<string, string>;
  }
) {
  const url = `https://api.github.com/repos/${args.repo}/actions/workflows/${args.workflow}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref: args.branch ?? "main",
      inputs: args.inputs,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    await prisma.ciCdJob.update({
      where: { id: jobId },
      data: { status: "failed", error: `HTTP ${res.status}: ${text}`, completedAt: new Date() },
    });
    return;
  }

  await prisma.ciCdJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      runUrl: `https://github.com/${args.repo}/actions`,
      completedAt: new Date(),
    },
  });
}

export async function listCiCdJobs(userId: string, limit = 50) {
  return prisma.ciCdJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
