/**
 * ReAct loop engine for CofounderAgent.
 *
 * The hosted container returns tool_calls but does NOT execute them.
 * This backend drives the loop: execute tools, feed results back as user
 * messages, and repeat until the agent stops calling tools.
 *
 * v2 additions:
 * - Diff previews for write_file and search_replace
 * - Approval polling (keeps SSE open while waiting for human gate)
 * - AbortSignal support for stop button
 */

import { prisma } from "@/src/prisma";
import {
  extractUsage,
  flattenEnvelope,
  generateImages,
  isValidResponseId,
  type ResponsesEnvelope,
} from "@/src/foundryClient";
import { invokeLLM } from "@/src/server/llmRouter";
import { logEvent } from "@/src/server/analytics";
import { recordTokenUsage } from "@/src/server/tokenTracker";
import { redactSecrets } from "@/src/server/secretsPolicy";
import { checkCostCap, truncateHistory } from "@/src/server/loopSafety";
import { extractAndStripFacts } from "@/src/server/factExtractor";
import { createFact, type FactCategory } from "@/src/memory";
import {
  readFileTool,
  listDirectoryTool,
  writeFileTool,
  applySearchReplace,
  createRollbackSnapshot,
  generateDiff,
} from "@/src/server/fsTools";
import { runCommandTool } from "@/src/server/shellTools";
import { fetchUrlTool } from "@/src/server/webTools";
import { grepTool } from "@/src/server/codeSearch";
import {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBranchTool,
  gitShowTool,
} from "@/src/server/gitTools";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Maximum ReAct iterations per chat turn. Bumped 2026-05-14 from 10 → 25.
 * Realistic coworker tasks (read → grep → edit → test → fix → test → commit)
 * are 8–15 iterations; 10 was cutting off mid-task. The real safety guard is
 * `MAX_CONVERSATION_COST_USD` (now properly wired by Bug-3 fix).
 */
export const MAX_AGENT_LOOPS = 25;
export const LOOP_TIMEOUT_MS = 300_000;
export const APPROVAL_POLL_MS = 500;
export const APPROVAL_TIMEOUT_MS = 300_000; // 5 minutes

const SAFE_TOOLS = new Set([
  "read_file", "list_directory", "grep", "find_files",
  "fetch_url", "git_status", "git_diff", "git_log", "git_branch", "git_show",
  "add", "multiply",
]);

const DESTRUCTIVE_TOOLS = new Set(["write_file", "search_replace", "run_command", "generate_image"]);

export interface ToolCall {
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  call_id: string;
  name: string;
  output: string;
  status: "ok" | "error" | "awaiting_approval";
  approvalId?: string;
  rollbackDir?: string;
  diff?: string;
}

export interface LoopEvent {
  type: "status" | "tool_call" | "tool_result" | "approval_required" | "approval_resolved" | "assistant_text" | "done" | "error";
  data: unknown;
}

export type LoopEventHandler = (event: LoopEvent) => void | Promise<void>;

import type { DeploymentSpec, UserKeys } from "@/src/modelRouting";

export interface LoopContext {
  userId: string;
  conversationId: string;
  agentName: string;
  route: DeploymentSpec;
  toolsMode: "off" | "ask" | "allowed";
  repoRoot: string;
  imageQuality?: string;
  imageSize?: string;
  onEvent: LoopEventHandler;
  signal?: AbortSignal;
  memoryPreamble?: string;
  /**
   * BYOK per-request keys. Forwarded to invokeLLM (chat) and
   * generateImages (image-gen tool). Never persisted.
   */
  userKeys?: UserKeys;
}

function parseToolCalls(envelope: ResponsesEnvelope): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const item of envelope.output ?? []) {
    if (item.type === "function_call") {
      const fc = item as { id?: string; call_id?: string; name?: string; arguments?: string };
      calls.push({
        id: fc.id ?? fc.call_id ?? "",
        call_id: fc.call_id ?? fc.id ?? "",
        name: fc.name ?? "unknown",
        arguments: fc.arguments ?? "{}",
      });
    }
  }
  return calls;
}

function getRepoPath(rel: string, repoRoot: string): string {
  return join(repoRoot, rel.replace(/^\//, ""));
}

async function executeTool(call: ToolCall, ctx: LoopContext): Promise<ToolResult> {
  const { repoRoot, toolsMode, userId, conversationId, signal } = ctx;
  const name = call.name;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return { call_id: call.call_id, name, output: "Error: invalid JSON arguments", status: "error" };
  }

  const needsApproval = DESTRUCTIVE_TOOLS.has(name) && toolsMode !== "allowed";
  if (needsApproval) {
    const approval = await prisma.approval.create({
      data: {
        userId,
        toolName: name,
        description: `${name}(${call.arguments.slice(0, 200)})`,
        paramsJson: call.arguments,
        status: "pending",
      },
    });
    return {
      call_id: call.call_id,
      name,
      output: `Approval required for ${name}.`,
      status: "awaiting_approval",
      approvalId: approval.id,
    };
  }

  try {
    let output = "";
    let rollbackDir: string | undefined;
    let diff: string | undefined;

    switch (name) {
      case "read_file": {
        const res = readFileTool({ path: String(args.path), repoRoot });
        output = res.content;
        break;
      }
      case "list_directory": {
        const res = listDirectoryTool({ path: String(args.path ?? "."), repoRoot });
        output = JSON.stringify(res.entries);
        break;
      }
      case "write_file": {
        const path = String(args.path);
        const content = String(args.content);
        const fullPath = getRepoPath(path, repoRoot);
        const oldContent = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : "";
        const snapDir = `/tmp/cofounder_rollback_${Date.now()}`;
        createRollbackSnapshot({ paths: [path], repoRoot, snapshotDir: snapDir });
        await prisma.rollbackSnapshot.create({
          data: {
            userId,
            conversationId,
            snapshotDir: snapDir,
            pathsJson: JSON.stringify([path]),
          },
        });
        const res = writeFileTool({ path, content, repoRoot });
        output = `Wrote ${res.bytes} bytes to ${res.path}`;
        rollbackDir = snapDir;
        if (oldContent !== content) {
          diff = generateDiff({ path, oldContent, newContent: content }).patch;
        }
        break;
      }
      case "search_replace": {
        const path = String(args.path);
        const search = String(args.search);
        const replace = String(args.replace);
        const fullPath = getRepoPath(path, repoRoot);
        const oldContent = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : "";
        const snapDir = `/tmp/cofounder_rollback_${Date.now()}`;
        createRollbackSnapshot({ paths: [path], repoRoot, snapshotDir: snapDir });
        await prisma.rollbackSnapshot.create({
          data: {
            userId,
            conversationId,
            snapshotDir: snapDir,
            pathsJson: JSON.stringify([path]),
          },
        });
        const res = applySearchReplace({ path, search, replace, repoRoot });
        output = `Modified ${res.path} (${res.bytes} bytes)`;
        rollbackDir = snapDir;
        const newContent = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : "";
        if (oldContent !== newContent) {
          diff = generateDiff({ path, oldContent, newContent }).patch;
        }
        break;
      }
      case "run_command": {
        const res = await runCommandTool({
          command: String(args.command),
          cwd: String(args.cwd ?? "."),
          timeoutMs: Number(args.timeoutMs ?? 30000),
          repoRoot,
        });
        output = `exit=${res.exitCode}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`;
        break;
      }
      case "generate_image": {
        const gen = await generateImages({
          prompt: String(args.prompt),
          n: 1,
          quality: (args.quality as "auto" | "low" | "medium" | "high") ?? "auto",
          size: (args.size as "auto" | "1024x1024" | "1024x1536" | "1536x1024") ?? "auto",
          signal,
        });
        output = gen.images[0]
          ? `data:image/png;base64,${gen.images[0]}`
          : `Error: ${gen.errors[0] ?? "no image generated"}`;
        break;
      }
      case "fetch_url": {
        const res = await fetchUrlTool({ url: String(args.url), maxChars: Number(args.max_chars ?? 8000) });
        output = `Title: ${res.title ?? "N/A"}\n\n${res.text}`;
        break;
      }
      case "grep": {
        const res = await grepTool({
          pattern: String(args.pattern),
          path: String(args.path ?? "."),
          repoRoot,
          maxResults: Number(args.max_results ?? 50),
        });
        output = JSON.stringify(res);
        break;
      }
      case "git_status": {
        const res = await gitStatusTool({ cwd: String(args.cwd ?? "."), repoRoot });
        output = `${res.stdout}${res.stderr ? "\nstderr: " + res.stderr : ""}`;
        break;
      }
      case "git_diff": {
        const res = await gitDiffTool({ cwd: String(args.cwd ?? "."), repoRoot, target: String(args.target ?? "HEAD") });
        output = `${res.stdout}${res.stderr ? "\nstderr: " + res.stderr : ""}`;
        break;
      }
      case "git_log": {
        const res = await gitLogTool({ cwd: String(args.cwd ?? "."), repoRoot, n: Number(args.n ?? 10) });
        output = `${res.stdout}${res.stderr ? "\nstderr: " + res.stderr : ""}`;
        break;
      }
      case "git_branch": {
        const res = await gitBranchTool({ cwd: String(args.cwd ?? "."), repoRoot });
        output = `${res.stdout}${res.stderr ? "\nstderr: " + res.stderr : ""}`;
        break;
      }
      case "git_show": {
        const res = await gitShowTool({ cwd: String(args.cwd ?? "."), repoRoot, ref: String(args.ref) });
        output = `${res.stdout}${res.stderr ? "\nstderr: " + res.stderr : ""}`;
        break;
      }
      case "add": {
        output = String(Number(args.a) + Number(args.b));
        break;
      }
      case "multiply": {
        output = String(Number(args.a) * Number(args.b));
        break;
      }
      default:
        output = `Unknown tool: ${name}`;
    }
    return { call_id: call.call_id, name, output, status: "ok", rollbackDir, diff };
  } catch (err) {
    return { call_id: call.call_id, name, output: `Error: ${String(err)}`, status: "error" };
  }
}

async function buildAgentInput(
  conversationId: string,
  options: { systemOverride?: string | null } = {},
): Promise<Array<{ role: "user" | "assistant" | "developer"; content: string }>> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) throw new Error("Conversation not found");

  const items: Array<{ role: "user" | "assistant" | "developer"; content: string }> = [];
  for (const m of conv.messages) {
    if (m.sender === "system") continue;
    const role = m.sender === "user" ? "user" : "assistant";
    let content = m.text ?? "";
    if (m.toolCallsJson) {
      content += "\n[tool_calls: " + m.toolCallsJson + "]";
    }
    items.push({ role, content });
  }

  // Inject persona prompt + memory preamble as a SYSTEM_OVERRIDE block
  // on the FIRST user message of the conversation. Foundry hosted agents
  // reject the Responses-protocol `instructions` field (HTTP 400
  // `invalid_payload` / `param: instructions`), so we have to smuggle
  // the override through the user channel. We only do it on the first
  // user message so subsequent turns don't re-stack the override on
  // every loop iteration.
  if (options.systemOverride) {
    const firstUserIdx = items.findIndex((it) => it.role === "user");
    if (firstUserIdx >= 0) {
      items[firstUserIdx] = {
        ...items[firstUserIdx],
        content: `[SYSTEM_OVERRIDE]\n${options.systemOverride}\n[/SYSTEM_OVERRIDE]\n\n${items[firstUserIdx].content}`,
      };
    }
  }

  return truncateHistory(items);
}

/** Send an SSE heartbeat at most every 10s while we wait for approval, so
 *  proxies and the browser keep the stream open and the UI can show a
 *  "waiting for your approval" countdown instead of looking hung. */
const APPROVAL_HEARTBEAT_MS = 10_000;

async function pollApproval(
  approvalId: string,
  signal?: AbortSignal,
  onHeartbeat?: (info: { elapsedMs: number; remainingMs: number }) => void | Promise<void>,
): Promise<"approved" | "rejected" | "timeout"> {
  const startedAt = Date.now();
  const deadline = startedAt + APPROVAL_TIMEOUT_MS;
  let lastHeartbeatAt = startedAt;

  while (Date.now() < deadline) {
    if (signal?.aborted) return "timeout";
    const approval = await prisma.approval.findUnique({ where: { id: approvalId } });
    if (!approval) return "timeout";
    if (approval.status === "approved") return "approved";
    if (approval.status === "rejected") return "rejected";

    const now = Date.now();
    if (onHeartbeat && now - lastHeartbeatAt >= APPROVAL_HEARTBEAT_MS) {
      lastHeartbeatAt = now;
      try {
        await onHeartbeat({
          elapsedMs: now - startedAt,
          remainingMs: Math.max(0, deadline - now),
        });
      } catch {
        // Heartbeat is best-effort; never abort polling on transport errors.
      }
    }

    await new Promise((r) => setTimeout(r, APPROVAL_POLL_MS));
  }
  return "timeout";
}

export async function runReActLoop(ctx: LoopContext): Promise<{
  text: string;
  imageBase64: string | null;
  toolCalls: ToolCall[];
  loopCount: number;
  approvalsCreated: string[];
}> {
  const { userId, conversationId, agentName, route, onEvent, signal, memoryPreamble } = ctx;
  let loopCount = 0;
  const approvalsCreated: string[] = [];
  const allToolCalls: ToolCall[] = [];
  let finalText = "";
  let finalImage: string | null = null;
  const startTime = Date.now();

  // Cost cap check
  const costCheck = await checkCostCap(conversationId);
  if (!costCheck.allowed) {
    await onEvent({
      type: "error",
      data: {
        code: "cost_cap_exceeded",
        message: `Conversation cost $${costCheck.currentCost.toFixed(4)} exceeds cap of $${costCheck.cap}.`,
      },
    });
    return { text: "[Cost cap exceeded]", imageBase64: null, toolCalls: [], loopCount: 0, approvalsCreated: [] };
  }

  while (loopCount < MAX_AGENT_LOOPS) {
    if (signal?.aborted) {
      await onEvent({ type: "error", data: { code: "aborted", message: "Stopped by user" } });
      break;
    }
    if (Date.now() - startTime > LOOP_TIMEOUT_MS) {
      await onEvent({ type: "error", data: { code: "loop_timeout", message: "Max loop duration exceeded" } });
      break;
    }

    // Re-check cost cap each iteration
    const iterationCost = await checkCostCap(conversationId);
    if (!iterationCost.allowed) {
      await onEvent({
        type: "error",
        data: {
          code: "cost_cap_exceeded",
          message: `Conversation cost $${iterationCost.currentCost.toFixed(4)} exceeds cap of $${iterationCost.cap}.`,
        },
      });
      break;
    }

    await onEvent({ type: "status", data: { status: "thinking", loop: loopCount + 1 } });

    // On loop iteration 0 (first turn), prepend the persona-prompt +
    // memory preamble inside the first user message as a [SYSTEM_OVERRIDE]
    // block. On later iterations it has already been baked into history
    // via the persisted user message + previous_response_id chain, so
    // skip re-injecting it.
    const input = await buildAgentInput(conversationId, {
      systemOverride: loopCount === 0 ? memoryPreamble ?? null : null,
    });

    let envelope: ResponsesEnvelope;
    try {
      envelope = await invokeLLM(route, agentName, {
        input,
        // NOTE: `instructions` is rejected by Foundry hosted agents
        // (HTTP 400 invalid_payload / param: instructions). The
        // override is smuggled in via the user channel above.
      }, { signal });
    } catch (err) {
      const e = err as { status?: number; message?: string };
      await onEvent({ type: "error", data: { code: "foundry_invoke_failed", status: e.status, message: e.message } });
      throw err;
    }

    if (envelope.status === "failed" || envelope.error) {
      await onEvent({ type: "error", data: { code: "agent_failed", envelopeError: envelope.error, status: envelope.status } });
      throw new Error(`Agent failed: ${envelope.error?.message ?? envelope.status}`);
    }

    const flat = flattenEnvelope(envelope);
    const toolCalls = parseToolCalls(envelope);

    // Redact secrets defensively from assistant text before persistence.
    // The model can echo a secret it read from a file before our tool-output
    // redactor would have a chance to mask it on the next turn — see Bug-A4.
    const safeAssistantText = flat.text ? redactSecrets(flat.text) : null;

    // Store assistant turn
    const assistantMsg = await prisma.message.create({
      data: {
        conversationId,
        sender: "assistant",
        persona: null,
        text: safeAssistantText,
        imageBase64: flat.imageBase64,
        toolCallsJson: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
        modelUsed: route.deployment,
      },
    });

    // Real token accounting from the envelope (Bug-3 fix). Falls back to 0/0
    // when the upstream omits usage — no fake heuristics.
    const { promptTokens, completionTokens } = extractUsage(envelope);
    await recordTokenUsage({
      userId,
      conversationId,
      messageId: assistantMsg.id,
      modelUsed: route.deployment,
      promptTokens,
      completionTokens,
    });

    // Persist the response id so the next turn can chain (Bug-2 fix). We
    // only chain when the id matches the Responses-protocol shape; otherwise
    // passing it back produces an upstream HTTP 500.
    if (isValidResponseId(envelope.id)) {
      try {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { previousResponseId: envelope.id },
        });
      } catch (err) {
        // Non-fatal: the next turn will just start a fresh chain.
        console.warn("[agentLoop] previousResponseId persist failed:", err);
      }
    }

    if (flat.text) {
      await onEvent({ type: "assistant_text", data: { text: safeAssistantText, messageId: assistantMsg.id } });
    }

    if (toolCalls.length === 0) {
      // Final turn — extract MEMORY_FACT markers from the assistant text so
      // the persistent fact store stays in sync (parity with handleSingleTurn).
      // We extract from the REDACTED text so secrets can't be turned into
      // "memories" the agent re-reads later.
      let factsExtracted = 0;
      if (safeAssistantText) {
        const { cleaned, facts } = extractAndStripFacts(safeAssistantText);
        if (facts.length > 0) {
          // Strip markers from the stored message — UI and future replays
          // should never see the routing-internal syntax.
          if (cleaned !== safeAssistantText) {
            await prisma.message.update({
              where: { id: assistantMsg.id },
              data: { text: cleaned || null },
            });
          }
          for (const f of facts) {
            try {
              await createFact({
                userId,
                category: f.category as FactCategory,
                label: f.label,
                fullText: f.fullText,
                importance: f.importance,
                source: `conversation:${conversationId}`,
              });
              factsExtracted++;
            } catch (err) {
              console.warn("[agentLoop.facts] createFact failed:", err);
            }
          }
        }
        finalText = cleaned;
      } else {
        finalText = "";
      }
      finalImage = flat.imageBase64;
      if (factsExtracted > 0) {
        await onEvent({ type: "status", data: { status: "facts_saved", count: factsExtracted } });
      }
      break;
    }

    allToolCalls.push(...toolCalls);

    // Execute tools
    const toolResults: ToolResult[] = [];
    for (const call of toolCalls) {
      if (signal?.aborted) break;
      await onEvent({ type: "tool_call", data: { name: call.name, arguments: call.arguments, call_id: call.call_id } });
      const result = await executeTool(call, ctx);
      toolResults.push(result);
      await onEvent({ type: "tool_result", data: result });

      if (result.status === "awaiting_approval" && result.approvalId) {
        approvalsCreated.push(result.approvalId);
      }
    }

    if (signal?.aborted) break;

    // Check for approvals — poll if needed
    const pendingApproval = toolResults.find((r) => r.status === "awaiting_approval");
    if (pendingApproval?.approvalId) {
      await onEvent({
        type: "approval_required",
        data: {
          call_id: pendingApproval.call_id,
          name: pendingApproval.name,
          approvalId: pendingApproval.approvalId,
          description: `Approve ${pendingApproval.name}?`,
        },
      });

      const resolution = await pollApproval(
        pendingApproval.approvalId,
        signal,
        async (hb) => {
          await onEvent({
            type: "status",
            data: {
              status: "awaiting_approval",
              approvalId: pendingApproval.approvalId,
              elapsedMs: hb.elapsedMs,
              remainingMs: hb.remainingMs,
              heartbeat: true,
            },
          });
        },
      );
      await onEvent({ type: "approval_resolved", data: { approvalId: pendingApproval.approvalId, resolution } });

      if (resolution === "approved") {
        // Re-execute the tool now that it's approved
        const call = toolCalls.find((c) => c.call_id === pendingApproval.call_id);
        if (call) {
          const reResult = await executeTool({ ...call, name: call.name }, { ...ctx, toolsMode: "allowed" });
          const idx = toolResults.findIndex((r) => r.call_id === pendingApproval.call_id);
          if (idx >= 0) toolResults[idx] = reResult;
          await onEvent({ type: "tool_result", data: reResult });
        }
      } else if (resolution === "rejected") {
        pendingApproval.output = `User rejected ${pendingApproval.name}.`;
        pendingApproval.status = "error";
      } else {
        pendingApproval.output = `Approval timed out for ${pendingApproval.name}.`;
        pendingApproval.status = "error";
      }
    }

    // Store tool results as messages (redact secrets before DB write)
    for (const result of toolResults) {
      const safeOutput = redactSecrets(result.output);
      const safeDiff = result.diff ? redactSecrets(result.diff) : undefined;
      await prisma.message.create({
        data: {
          conversationId,
          sender: "tool",
          persona: null,
          text: `[TOOL_RESULT:${result.name}]\n${safeOutput}\n[/TOOL_RESULT]`,
          toolCallsJson: safeDiff ? JSON.stringify({ diff: safeDiff }) : null,
        },
      });
    }

    loopCount++;
  }

  await onEvent({ type: "done", data: { loopCount, approvalsCreated: approvalsCreated.length } });
  await logEvent(userId, "react_loop_completed", { conversationId, loopCount, approvals: approvalsCreated.length });

  return { text: finalText, imageBase64: finalImage, toolCalls: allToolCalls, loopCount, approvalsCreated };
}
