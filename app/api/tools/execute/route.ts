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
  toolName: z.string().min(1),
  paramsJson: z.string().min(1),
  conversationId: z.string().optional(),
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

    const policy = await prisma.toolPolicy.findUnique({
      where: { userId_toolName: { userId: principal.userId, toolName: body.toolName } },
    });
    const effectivePolicy = policy?.policy ?? "ask";

    const execution = await prisma.toolExecution.create({
      data: {
        userId: principal.userId,
        toolName: body.toolName,
        status: effectivePolicy === "ask" ? "pending" : "autonomous",
        paramsJson: body.paramsJson,
      },
    });

    // Destructive operations always require approval regardless of policy.
    const alwaysApprove = ["read_file", "list_directory", "fetch_url", "grep", "find_files", "git_status", "git_diff", "git_log", "git_branch", "git_show"];
    const needsApproval = !alwaysApprove.includes(body.toolName);

    if (needsApproval && (effectivePolicy === "ask" || effectivePolicy === "readonly")) {
      const approval = await prisma.approval.create({
        data: {
          userId: principal.userId,
          toolName: body.toolName,
          description: `${body.toolName} requested`,
          paramsJson: body.paramsJson,
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

    if (effectivePolicy === "blocked") {
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
      const params = JSON.parse(body.paramsJson);
      const repoRoot = getRepoRoot();

      switch (body.toolName) {
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
        toolName: body.toolName,
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
