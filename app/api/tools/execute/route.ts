import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import {
  readFileTool,
  listDirectoryTool,
  writeFileTool,
  applySearchReplace,
  generateDiff,
  createRollbackSnapshot,
} from "@/src/server/fsTools";
import { runCommandTool } from "@/src/server/shellTools";
import { fetchUrlTool } from "@/src/server/webTools";
import { grepTool, findFilesTool } from "@/src/server/codeSearch";
import { gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitShowTool } from "@/src/server/gitTools";
import { logEvent } from "@/src/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ExecuteBody = z.object({
  toolName: z.string().min(1).optional(),
  paramsJson: z.string().min(1).optional(),
  conversationId: z.string().optional(),
  approvalId: z.string().optional(),
  overridePolicy: z.enum(["allow_all"]).optional(),
});

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? process.cwd();
}

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("tools.execute.POST", async () => {
    let body;
    try {
      body = ExecuteBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "tools.execute.parse");
    }

    let toolName = body.toolName ?? "";
    let paramsJson = body.paramsJson ?? "";
    let executionId: string | null = null;

    if (body.approvalId) {
      const approval = await prisma.approval.findFirst({
        where: { id: body.approvalId, userId: principal.userId },
      });
      if (!approval) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      if (approval.status !== "approved") {
        return NextResponse.json({ error: "approval_not_ready" }, { status: 409 });
      }
      if (!approval.toolExecutionId) {
        return NextResponse.json({ error: "missing_execution" }, { status: 409 });
      }
      toolName = approval.toolName;
      paramsJson = approval.paramsJson;
      executionId = approval.toolExecutionId;
    }

    const policy = await prisma.toolPolicy.findUnique({
      where: { userId_toolName: { userId: principal.userId, toolName } },
    });
    const effectivePolicy = body.overridePolicy === "allow_all" ? "allowed" : policy?.policy ?? "ask";

    const execution = executionId
      ? await prisma.toolExecution.findUnique({ where: { id: executionId } })
      : await prisma.toolExecution.create({
          data: {
            userId: principal.userId,
            toolName,
            status: effectivePolicy === "ask" ? "pending" : "autonomous",
            paramsJson,
          },
        });

    if (!execution) {
      return NextResponse.json({ error: "execution_not_found" }, { status: 404 });
    }

    // Destructive operations always require approval regardless of policy.
    const alwaysApprove = ["read_file", "list_directory", "fetch_url", "grep", "find_files", "git_status", "git_diff", "git_log", "git_branch", "git_show"];
    const needsApproval = !alwaysApprove.includes(toolName);

    if (!body.approvalId && needsApproval && (effectivePolicy === "ask" || effectivePolicy === "readonly")) {
      const approval = await prisma.approval.create({
        data: {
          userId: principal.userId,
          toolName,
          description: `${toolName} requested`,
          paramsJson,
          status: "pending",
          toolExecutionId: execution.id,
        },
      });
      return NextResponse.json(
        {
          status: "awaiting_approval",
          approvalId: approval.id,
          executionId: execution.id,
        },
        { status: 202 }
      );
    }

    if (!body.approvalId && effectivePolicy === "blocked") {
      await prisma.toolExecution.update({
        where: { id: execution.id },
        data: { status: "blocked", completedAt: new Date() },
      });
      return NextResponse.json(
        { status: "blocked", executionId: execution.id },
        { status: 403 }
      );
    }

    let result: unknown;
    try {
      const params = JSON.parse(paramsJson);
      const repoRoot = getRepoRoot();

      switch (toolName) {
        case "read_file": {
          result = readFileTool({ path: params.path, repoRoot });
          break;
        }
        case "list_directory": {
          result = listDirectoryTool({ path: params.path ?? ".", repoRoot });
          break;
        }
        case "write_file": {
          const snapDir = `/tmp/cofounder_rollback_${Date.now()}`;
          createRollbackSnapshot({ paths: [params.path], repoRoot, snapshotDir: snapDir });
          const res = writeFileTool({ path: params.path, content: params.content, repoRoot });
          result = { ...res, rollbackDir: snapDir };
          break;
        }
        case "search_replace": {
          const snapDir = `/tmp/cofounder_rollback_${Date.now()}`;
          createRollbackSnapshot({ paths: [params.path], repoRoot, snapshotDir: snapDir });
          const res = applySearchReplace({
            path: params.path,
            search: params.search,
            replace: params.replace,
            repoRoot,
          });
          result = { ...res, rollbackDir: snapDir };
          break;
        }
        case "run_command": {
          result = await runCommandTool({
            command: params.command,
            cwd: params.cwd ?? ".",
            timeoutMs: params.timeoutMs,
            repoRoot,
          });
          break;
        }
        case "fetch_url": {
          result = await fetchUrlTool({ url: params.url, maxChars: params.maxChars });
          break;
        }
        case "http_request": {
          const method = String(params.method ?? "GET").toUpperCase();
          const url = String(params.url ?? "");
          if (!url) throw new Error("missing_url");
          const headers = typeof params.headers === "object" && params.headers ? params.headers : {};
          const body = params.body ? String(params.body) : undefined;
          const resp = await fetch(url, {
            method,
            headers: headers as Record<string, string>,
            body: body && method !== "GET" ? body : undefined,
          });
          const text = await resp.text();
          result = {
            status: resp.status,
            ok: resp.ok,
            headers: Object.fromEntries(resp.headers.entries()),
            body: text.slice(0, 200000),
          };
          break;
        }
        case "calendar_create": {
          const res = await fetch(`${req.nextUrl.origin}/api/calendar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          const json = await res.json();
          result = json;
          break;
        }
        case "calendar_list": {
          const limit = params.limit ? Number(params.limit) : 50;
          const res = await fetch(`${req.nextUrl.origin}/api/calendar?limit=${limit}`);
          const json = await res.json();
          result = json;
          break;
        }
        case "grep": {
          result = await grepTool({
            pattern: params.pattern,
            path: params.path,
            repoRoot,
            maxResults: params.maxResults,
          });
          break;
        }
        case "find_files": {
          result = await findFilesTool({
            pattern: params.pattern,
            repoRoot,
            maxResults: params.maxResults,
          });
          break;
        }
        case "git_status": {
          result = await gitStatusTool({ cwd: params.cwd, repoRoot });
          break;
        }
        case "git_diff": {
          result = await gitDiffTool({ cwd: params.cwd, repoRoot, target: params.target });
          break;
        }
        case "git_log": {
          result = await gitLogTool({ cwd: params.cwd, repoRoot, n: params.n });
          break;
        }
        case "git_branch": {
          result = await gitBranchTool({ cwd: params.cwd, repoRoot });
          break;
        }
        case "git_show": {
          result = await gitShowTool({ cwd: params.cwd, repoRoot, ref: params.ref });
          break;
        }
        default:
          result = { note: `Tool ${body.toolName} not yet implemented` };
      }

      await prisma.toolExecution.update({
        where: { id: execution.id },
        data: {
          status: "autonomous",
          resultJson: JSON.stringify(result),
          completedAt: new Date(),
        },
      });

      await logEvent(principal.userId, "tool_executed", {
        toolName,
        conversationId: body.conversationId,
      });
    } catch (err) {
      await prisma.toolExecution.update({
        where: { id: execution.id },
        data: {
          status: "failed",
          error: String(err),
          completedAt: new Date(),
        },
      });
      return NextResponse.json(
        { status: "failed", executionId: execution.id, error: String(err) },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "completed",
      executionId: execution.id,
      result,
    });
  });
}
