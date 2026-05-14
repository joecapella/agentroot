import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/prisma";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { glob } from "glob";
import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  source: z.string().min(1),
  repoRoot: z.string().min(1),
  include: z.string().default("**/*.{ts,tsx,js,jsx,py,md,prisma,bicep,yaml,yml,json}"),
  exclude: z.string().default("**/node_modules/**,**/.next/**,**/.venv/**,**/__pycache__/**,**/dist/**"),
});

function chunkText(text: string, maxChars = 2000): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxChars;
    if (end >= text.length) {
      chunks.push(text.slice(start));
      break;
    }
    const nl = text.lastIndexOf("\n", end);
    if (nl > start) end = nl;
    chunks.push(text.slice(start, end));
    start = end + 1;
  }
  return chunks;
}

function extractKeywords(text: string): string {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length > 3 && !["this","that","with","from","they","have","been","their","will","would","should","could"].includes(w));
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => w)
    .join(" ");
}

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("retrieval.index.POST", async () => {
    let body;
    try {
      body = Body.parse(await req.json());
    } catch (err) {
      return sanitizedError("bad_request", 400, err, "retrieval.index.parse");
    }

    const excludes = body.exclude.split(",").map((s) => s.trim());
    const files = await glob(body.include, {
      cwd: body.repoRoot,
      ignore: excludes,
      absolute: true,
    });

    await prisma.retrievalIndex.deleteMany({
      where: { userId: principal.userId, source: body.source },
    });

    const inserted: Array<{ path: string; chunkId: string }> = [];

    for (const filePath of files.slice(0, 500)) {
      let text: string;
      try {
        text = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      const rel = relative(body.repoRoot, filePath);
      const chunks = chunkText(text, 2000);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = `${basename(rel)}#${i}`;
        const keywords = extractKeywords(chunk);
        await prisma.retrievalIndex.create({
          data: {
            userId: principal.userId,
            source: body.source,
            path: rel,
            chunkId,
            content: chunk,
            keywords,
          },
        });
        inserted.push({ path: rel, chunkId });
      }
    }

    return NextResponse.json({ indexed: inserted.length, files: files.length });
  });
}
