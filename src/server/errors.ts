/**
 * Centralized error sanitizer for API routes.
 *
 * Rule: clients see `{ error: <stable code>, requestId?: <opaque> }`.
 * Full detail (stack, upstream body, filesystem paths) is logged server-side
 * only. This addresses the Information Exposure findings (CWE-200) raised in
 * the second Control Agent review.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export function newRequestId(): string {
  return randomUUID();
}

/**
 * Log full detail under a request id, return a sanitized JSON response.
 */
export function sanitizedError(
  code: string,
  status: number,
  detail: unknown,
  context: string
): NextResponse {
  const requestId = newRequestId();
  // Never let exceptions in the logger itself escape.
  try {
    console.error(
      "[api-error] requestId=%s context=%s code=%s detail=%o",
      requestId,
      context,
      code,
      detail
    );
  } catch {
    /* ignore */
  }
  return NextResponse.json({ error: code, requestId }, { status });
}

/**
 * Wrap a Prisma/route handler body in try/catch. Use:
 *
 *   return runRoute("conversations.GET", async () => {
 *     const list = await prisma.conversation.findMany(...);
 *     return NextResponse.json({ conversations: list });
 *   });
 */
export async function runRoute(
  context: string,
  fn: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    return sanitizedError("internal_error", 500, err, context);
  }
}
