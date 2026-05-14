import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { restoreRollback } from "@/src/server/fsTools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostBody = z.object({
  snapshotDir: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("rollback.POST", async () => {
    let body;
    try {
      body = PostBody.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "rollback.parse");
    }

    const snapshot = await prisma.rollbackSnapshot.findFirst({
      where: { userId: principal.userId, snapshotDir: body.snapshotDir },
    });

    if (!snapshot) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    try {
      restoreRollback({ snapshotDir: body.snapshotDir, repoRoot: process.env.REPO_ROOT ?? process.cwd() });
      await prisma.rollbackSnapshot.update({
        where: { id: snapshot.id },
        data: { pathsJson: JSON.stringify([...(JSON.parse(snapshot.pathsJson) as string[]), "restored"]) },
      });
      return NextResponse.json({ restored: true, snapshotDir: body.snapshotDir });
    } catch (err) {
      return NextResponse.json(
        { error: "restore_failed", message: String(err) },
        { status: 500 }
      );
    }
  });
}

/**
 * Rollback snapshots older than this are eligible for sweep. We don't auto-
 * delete on every list call (cheap reads matter), but the cleanup endpoint
 * (DELETE) honours this. Kept module-local because Next.js App Router
 * forbids non-handler named exports from `route.ts`.
 */
const ROLLBACK_SNAPSHOT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export async function GET(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;

  return runRoute("rollback.GET", async () => {
    const snapshots = await prisma.rollbackSnapshot.findMany({
      where: { userId: principal.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({
      snapshots,
      ttlMs: ROLLBACK_SNAPSHOT_TTL_MS,
    });
  });
}

/**
 * Sweep snapshots older than `ROLLBACK_SNAPSHOT_TTL_MS`. Removes the on-disk
 * `/tmp/cofounder_rollback_*` directories AND the DB rows. Safe to call
 * repeatedly; idempotent. Owner-scoped.
 */
export async function DELETE(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("rollback.DELETE", async () => {
    const cutoff = new Date(Date.now() - ROLLBACK_SNAPSHOT_TTL_MS);
    const stale = await prisma.rollbackSnapshot.findMany({
      where: { userId: principal.userId, createdAt: { lt: cutoff } },
    });
    const { rmSync, existsSync } = await import("node:fs");
    let onDiskRemoved = 0;
    for (const s of stale) {
      try {
        if (existsSync(s.snapshotDir)) {
          rmSync(s.snapshotDir, { recursive: true, force: true });
          onDiskRemoved++;
        }
      } catch (err) {
        console.warn("[rollback.sweep] rm failed for", s.snapshotDir, err);
      }
    }
    const { count } = await prisma.rollbackSnapshot.deleteMany({
      where: { userId: principal.userId, createdAt: { lt: cutoff } },
    });
    return NextResponse.json({ removedRows: count, removedOnDisk: onDiskRemoved });
  });
}
